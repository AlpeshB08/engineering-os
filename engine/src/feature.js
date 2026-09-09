import fs from 'node:fs';
import path from 'node:path';
import {
  artifactPath,
  markArtifactStatus,
  validatePlanBundle,
} from './artifacts.js';
import { detectCapabilities, detectArchetype } from './detect.js';
import { applyIntakeToDiscoveryNotes, isContractSufficient, parseFeatureIntake, seedContractFromTaskDescription } from './intake.js';
import {
  fetchJiraIssue,
  normalizeJiraIssue,
  loadNormalizedJira,
  createPendingJiraStub,
  isJiraDiscoveryComplete,
  ingestNormalizedJira,
  ingestJiraFromJsonFile,
  extractJiraKey,
  seedContractFromJira,
} from './integrations/jira.js';
import {
  loadFigmaDiscovery,
  createPendingFigmaStub,
  isFigmaDiscoveryComplete,
  ingestFigmaDiscovery,
  ingestFigmaFromJsonFile,
  seedContractFromFigma,
} from './integrations/figma.js';
import {
  PRE_APPROVAL_PIPELINE,
  initOrchestration,
  isStepComplete,
  markStepComplete,
  addBlocker,
  clearBlockers,
  clearBlockersByType,
  hasBlockers,
  renderOrchestrationManifest,
} from './orchestration.js';
import { eosDir, fileExists, graphsDir } from './paths.js';
import { loadState, requireState, saveState } from './state.js';
import {
  generateFeatureImpact,
  writeFeatureImpact,
  rankReuse,
  writeReuseAnalysis,
  runIntelScan,
  generateGraphs,
} from './intelligence/index.js';
import { scaffoldBackendDependency } from './intelligence/backendScaffold.js';
import { fillVerificationMatrix } from './intelligence/verifyPlan.js';
import {
  decideTestStrategy,
  generateUnitScenarios,
  generateE2eScenarios,
  generateManualScenarios,
  renderTestStrategySection,
  renderTestScenariosSection,
  applyTestStrategyToVerificationPlan,
  applyTestScenariosToPlan,
  parseScenariosFromPlan,
  parseImpactSignals,
} from './intelligence/testStrategy.js';
import {
  detectTestCapabilities,
  resolveTestStrategyWithCapabilities,
  renderTestCapabilitySection,
  applyApprovedSetupWithVerification,
  recordTestCapabilityDecision,
  applyTestCapabilitySectionToPlan,
} from './intelligence/testCapabilities.js';
import {
  renderE2eAutomationSection,
  parseScenarioBullet,
} from './intelligence/e2eCapability.js';
import {
  applyContinueInput,
  authorizeImplementationFromConversation,
  buildFeatureTurn,
  collectTestCases,
  confirmDeliveryFromConversation,
  confirmReviewFromConversation,
  continueAfterImplementationGates,
  evaluateFeatureStage,
  initFeatureSession,
  persistConfirmedTestCases,
  recordImplementationAndVerify,
  recordManualQaEvidence,
  recordRegressionFromImpact,
  refreshVerificationFromConversation,
  reapplyAnsweredClarificationsToContract,
  renderFeatureTurn,
} from './featureLifecycle.js';
import {
  buildDecisionContext,
  getPendingDecisions,
  getWorkflowDecision,
  blockForPendingDecisions,
  enforceDecisionGate,
  hasPendingWorkflowDecisions,
  DECISION_IDS,
  DECISION_STATUS,
} from './workflowDecisions.js';
import { buildGuardManifest } from './guard.js';
import { discoverImplementationDecisions } from './decisionDiscovery.js';
import {
  buildRegressionImpact,
  renderRegressionBlastRadiusSection,
  decideRegressionStrategy,
  generateRegressionScenarios,
  generateQaRegressionScope,
  renderRegressionStrategySection,
  renderRegressionScenariosSection,
  renderQaRegressionScopeSection,
  renderRegressionTestImplementationPlaceholder,
  applyRegressionSectionsToPlan,
} from './intelligence/regressionImpact.js';
import {
  startWorkflow,
  advanceRunToPhase,
  loadWorkflow,
} from './workflow.js';
import { extractAcceptanceCriteria } from './intelligence/verificationMatrix.js';

function printFeatureTurn(root, state, resolved = null, { json = false } = {}) {
  const run = state.active_run;
  if (run) evaluateFeatureStage(run, resolved);
  const turn = buildFeatureTurn(root, state, resolved);
  if (json) {
    console.log(JSON.stringify(turn, null, 2));
  } else {
    console.log(renderFeatureTurn(turn));
  }
  return turn;
}

export async function cmdFeatureContinue(root, home, flags = {}) {
  const state = requireState(root);
  const run = state.active_run;
  if (!run) throw new Error('No active run.');
  initFeatureSession(run);

  const applied = applyContinueInput(
    run,
    {
      answer: flags.answer,
      confirm: flags.confirm,
      decisionId: flags.decision || flags.question,
      optionId: flags.option,
      implemented: Boolean(flags.implemented),
      force: Boolean(flags.force),
      source: flags.source || 'user',
    },
    { recordTestCapabilityDecision }
  );
  if (!applied.ok) {
    console.error(applied.error);
    process.exitCode = 1;
    const turn = printFeatureTurn(root, state, null, { json: Boolean(flags.json) });
    return { ok: false, error: applied.error, turn };
  }

  clearBlockersByType(run, ['workflow_decision', 'test_capability', 'test_capability_setup']);

  if (applied.action === 'implemented') {
    const reported = recordImplementationAndVerify(root, state, {
      summary: flags.summary || flags.answer || '',
      testsCreated: flags.testsCreated,
    });
    if (!reported.ok) {
      console.error(reported.error);
      process.exitCode = 1;
      saveState(root, state);
      const turn = printFeatureTurn(root, state, null, { json: Boolean(flags.json) });
      return { ok: false, ...reported, turn };
    }
    let regressionImpact = { candidates: [] };
    try {
      const impact = generateFeatureImpact(root, run.artifacts_dir, run.id);
      regressionImpact = buildRegressionImpact(root, impact);
    } catch {
      regressionImpact = { candidates: [] };
    }
    const context = buildWorkflowDecisionContext(root, state, run);
    recordRegressionFromImpact(root, run, context.resolved, regressionImpact);
    const advanced = continueAfterImplementationGates(root, home, state);
    if (
      !advanced.ok &&
      advanced.reason !== 'required regression pending' &&
      advanced.reason !== 'required manual QA pending'
    ) {
      console.error(advanced.reason || advanced.error || 'Could not enter verify.');
      process.exitCode = 1;
    }
    saveState(root, state);
    const turn = printFeatureTurn(root, state, context.resolved, { json: Boolean(flags.json) });
    return {
      ok: advanced.ok || advanced.reason === 'required regression pending' || advanced.reason === 'required manual QA pending',
      action: 'implemented',
      turn,
      advanced,
    };
  }

  if (applied.action === 'confirm_manual_qa') {
    recordManualQaEvidence(run);
    const context = buildWorkflowDecisionContext(root, state, run);
    const advanced = continueAfterImplementationGates(root, home, state);
    saveState(root, state);
    const turn = printFeatureTurn(root, state, context.resolved, { json: Boolean(flags.json) });
    return { ok: true, action: applied.action, turn, advanced };
  }

  if (applied.action === 'confirm_regression') {
    const context = buildWorkflowDecisionContext(root, state, run);
    const advanced = continueAfterImplementationGates(root, home, state);
    if (!advanced.ok) {
      console.error(advanced.reason || advanced.error || 'Could not enter verify.');
      process.exitCode = 1;
      saveState(root, state);
      const turn = printFeatureTurn(root, state, context.resolved, { json: Boolean(flags.json) });
      return { ok: false, ...advanced, turn };
    }
    saveState(root, state);
    const turn = printFeatureTurn(root, state, context.resolved, { json: Boolean(flags.json) });
    return { ok: true, action: applied.action, turn, advanced };
  }

  if (applied.action === 'confirm_review') {
    const reviewed = confirmReviewFromConversation(root, home, state);
    if (!reviewed.ok) {
      console.error(reviewed.error || reviewed.reason || 'Review was not accepted.');
      process.exitCode = 1;
    }
    saveState(root, state);
    const turn = printFeatureTurn(root, state, null, { json: Boolean(flags.json) });
    return { ok: Boolean(reviewed.ok), action: applied.action, turn, reviewed };
  }

  if (applied.action === 'confirm_delivery') {
    const delivered = confirmDeliveryFromConversation(root, home, state);
    if (!delivered.ok) {
      console.error(delivered.error || delivered.reason || 'Delivery was not accepted.');
      process.exitCode = 1;
      saveState(root, state);
    }
    const latest = loadState(root) || state;
    const turn = printFeatureTurn(root, latest, null, { json: Boolean(flags.json) });
    return { ok: Boolean(delivered.ok), action: applied.action, turn, delivered, completion: latest.last_completion };
  }

  if (applied.action === 'refresh_verification') {
    const refreshed = refreshVerificationFromConversation(root, state);
    if (!refreshed.ok) {
      console.error(refreshed.error);
      process.exitCode = 1;
    }
    const turn = printFeatureTurn(root, state, null, { json: Boolean(flags.json) });
    return { ok: Boolean(refreshed.ok), action: applied.action, turn, refreshed };
  }

  let resyncContext = null;
  if (PLAN_RESYNC_ACTIONS.has(applied.action)) {
    resyncContext = resyncVerificationPlanFromContract(root, state, run);
    if (applied.action === 'confirm_test_cases') {
      const session = initFeatureSession(run);
      const resolved = resyncContext?.resolved || { strategy: session.testing.strategy };
      session.testing.test_cases = collectTestCases(run, resolved, state.feature_intake || {});
      persistConfirmedTestCases(run, session);
    }
  }

  const pipeline = home ? await runPreApprovalPipeline(root, home, state) : { results: [] };
  if (PLAN_RESYNC_ACTIONS.has(applied.action)) {
    reapplyAnsweredClarificationsToContract(run);
    resyncContext = resyncVerificationPlanFromContract(root, state, run) || resyncContext;
  }
  const context = resyncContext || buildWorkflowDecisionContext(root, state, run);
  discoverImplementationDecisions(run, context);
  evaluateFeatureStage(run, context.resolved);

  if (
    initFeatureSession(run).testing.test_cases_confirmed &&
    !hasPendingWorkflowDecisions(run) &&
    run.current_phase !== 'implement'
  ) {
    if (!resyncContext) {
      persistConfirmedTestCases(run);
    }
    const auth = authorizeImplementationFromConversation(root, home, state);
    if (!auth.ok) {
      console.error(auth.reason || auth.error || 'Implementation was not authorized.');
      process.exitCode = 1;
      evaluateFeatureStage(run, context.resolved);
      saveState(root, state);
      const turn = printFeatureTurn(root, state, context.resolved, { json: Boolean(flags.json) });
      return { ok: false, ...auth, turn };
    }
  }

  evaluateFeatureStage(run, context.resolved);
  saveState(root, state);
  const turn = printFeatureTurn(root, state, context.resolved, { json: Boolean(flags.json) });
  return { ok: true, action: applied.action, turn, pipeline };
}

function dnaMissing(root) {
  return !fileExists(path.join(eosDir(root), 'intelligence', 'project-dna.md'));
}

function graphsMissing(root) {
  const gdir = graphsDir(root);
  if (!fileExists(gdir)) return true;
  return !fs.readdirSync(gdir).some((f) => f.endsWith('.json'));
}

export function runPreflight(root, home, state) {
  const caps = detectCapabilities(root);
  const archetype = detectArchetype(caps);
  state.capabilities = caps;
  state.archetype = archetype;
  state.test_capabilities = detectTestCapabilities(root, caps);
  const results = [{ step: 'detect', ok: true }];
  if (dnaMissing(root)) {
    runIntelScan(root, home);
    results.push({ step: 'intel-scan', ok: true });
  }
  if (graphsMissing(root)) {
    try {
      generateGraphs(root);
      results.push({ step: 'intel-graphs', ok: true });
    } catch (err) {
      results.push({ step: 'intel-graphs', ok: false, error: err.message });
    }
  }
  return results;
}

async function stepJiraDiscovery(root, state, run) {
  const intake = state.feature_intake;
  if (!intake?.jira?.key) return { ok: true, skipped: true };

  const key = intake.jira.key;
  const input = intake.jira.raw || key;

  const existing = loadNormalizedJira(root, key);
  if (existing && isJiraDiscoveryComplete(existing)) {
    ingestNormalizedJira(root, run, existing, { source: existing.discovery?.source || 'cached' });
    return { ok: true, source: 'cached' };
  }

  const fetched = await fetchJiraIssue(root, input);
  if (fetched.ok) {
    const normalized = normalizeJiraIssue(fetched.issue, fetched.key, 'rest');
    ingestNormalizedJira(root, run, normalized, { source: 'rest' });
    return { ok: true, source: 'rest' };
  }

  if (existing) {
    if (isJiraDiscoveryComplete(existing)) {
      ingestNormalizedJira(root, run, existing, { source: 'agent' });
      return { ok: true, source: 'agent' };
    }
  }

  const stub = createPendingJiraStub(key);
  ingestNormalizedJira(root, run, stub, { source: 'pending' });
  addBlocker(
    run,
    'jira',
    `Jira discovery incomplete for ${key}. Configure REST or provide normalized JSON via \`eos intel jira --from-json\`.`
  );
  return { ok: false, reason: 'jira_incomplete', key };
}

async function stepFigmaDiscovery(root, state, run) {
  const intake = state.feature_intake;
  if (!intake?.figma?.url) return { ok: true, skipped: true };

  const existing = loadFigmaDiscovery(root);
  if (existing?.url === intake.figma.url && isFigmaDiscoveryComplete(existing)) {
    ingestFigmaDiscovery(root, run, existing);
    return { ok: true, source: 'cached' };
  }

  const stub = createPendingFigmaStub(intake.figma.url);
  ingestFigmaDiscovery(root, run, stub);
  addBlocker(
    run,
    'figma',
    `Figma discovery required for ${intake.figma.url}. Use agent/MCP and \`eos intel figma --from-json\`.`
  );
  return { ok: false, reason: 'figma_incomplete' };
}

function stepFeatureContract(root, state, run) {
  const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
  let contract = fs.readFileSync(contractPath, 'utf8');
  const intake = state.feature_intake || {};

  if (intake.jira?.key) {
    const normalized = loadNormalizedJira(root, intake.jira.key);
    if (normalized && isJiraDiscoveryComplete(normalized)) {
      contract = seedContractFromJira(contract, normalized);
    }
  }

  if (intake.figma?.url) {
    const figma = loadFigmaDiscovery(root);
    if (figma && isFigmaDiscoveryComplete(figma)) {
      contract = seedContractFromFigma(contract, figma);
    }
  }

  if (intake.context) {
    contract = seedContractFromTaskDescription(contract, intake.context);
  }

  fs.writeFileSync(contractPath, contract);

  if (!isContractSufficient(contract)) {
    return { ok: true, reason: 'contract_missing_ac' };
  }

  markArtifactStatus(contractPath, 'ready-for-approval');
  return { ok: true };
}

function hasDiscoveryBlockers(run) {
  return (run.orchestration?.blockers || []).some((blocker) => blocker.type === 'jira' || blocker.type === 'figma');
}

function stepPlanIntelligence(root, home, state, run) {
  if (hasDiscoveryBlockers(run)) return { ok: false, reason: 'blocked' };
  clearBlockersByType(run, ['plan_bundle', 'plan_intelligence']);
  cmdOrchestratePlan(root, home);
  scaffoldImplementationPlan(run);
  return { ok: true };
}

function applyResolvedStrategyToPlan(root, run, resolved, intake = {}) {
  const artifactsDir = run.artifacts_dir;
  const contractPath = artifactPath(artifactsDir, 'feature-contract');
  const contract = fs.readFileSync(contractPath, 'utf8');
  const strategy = resolved.strategy;
  const unitScenarios = generateUnitScenarios({ contractText: contract, strategy });
  const e2eScenarios = generateE2eScenarios({ contractText: contract, strategy, intake });
  const manualScenarios = generateManualScenarios({ contractText: contract, strategy });
  const strategySection = renderTestStrategySection(strategy);
  const scenariosSection = renderTestScenariosSection(unitScenarios, e2eScenarios, manualScenarios);
  const capabilitySection = renderTestCapabilitySection(
    resolved.testCapabilities,
    resolved.proposals
  );

  let planPath = artifactPath(artifactsDir, 'verification-plan');
  let planContent = fs.readFileSync(planPath, 'utf8');
  planContent = applyTestStrategyToVerificationPlan(planContent, strategySection);
  planContent = applyTestScenariosToPlan(planContent, scenariosSection);
  const regressionImpact = (() => {
    try {
      return buildRegressionImpact(root, generateFeatureImpact(root, artifactsDir, run.id));
    } catch {
      return { candidates: [] };
    }
  })();
  const regressionStrategy = decideRegressionStrategy({
    regressionImpact,
    capabilities: detectCapabilities(root),
    featureStrategy: strategy,
  });
  const regressionScenarios = generateRegressionScenarios({ regressionImpact, regressionStrategy });
  const qaScope = generateQaRegressionScope({ regressionScenarios, regressionStrategy });
  planContent = applyRegressionSectionsToPlan(planContent, [
    ['## Regression Strategy', renderRegressionStrategySection(regressionStrategy)],
    ['## Regression Scenarios', renderRegressionScenariosSection(regressionScenarios, { required: regressionStrategy.required })],
    ['## QA Regression Scope', renderQaRegressionScopeSection(qaScope)],
    ['## Regression Test Implementation', renderRegressionTestImplementationPlaceholder()],
  ]);
  planContent = applyTestCapabilitySectionToPlan(planContent, capabilitySection);
  if (strategy.e2e?.required && resolved.testCapabilities?.e2e?.status === 'available') {
    const scenarios = parseScenariosFromPlan(planContent).map((s) => ({
      ...s,
      ...parseScenarioBullet(s.description || ''),
    }));
    const e2eSection = renderE2eAutomationSection({
      scenarios,
      testCapabilities: resolved.testCapabilities,
      runId: run.id,
      intake,
    });
    if (e2eSection && !planContent.includes('## E2E Automation')) {
      planContent = planContent.replace(
        '## Regression Strategy',
        `${e2eSection.trim()}\n\n## Regression Strategy`
      );
    }
  }
  fs.writeFileSync(planPath, planContent);
  run.test_capability_proposals = resolved.proposals;
  return planContent;
}

function stepTestCapability(root, state, run) {
  if (hasDiscoveryBlockers(run)) return { ok: false, reason: 'blocked' };

  const caps = state.capabilities || detectCapabilities(root);
  const testCapabilities = state.test_capabilities || detectTestCapabilities(root, caps);
  state.test_capabilities = testCapabilities;

  const planPath = artifactPath(run.artifacts_dir, 'verification-plan');
  const planContent = fs.readFileSync(planPath, 'utf8');
  const contract = fs.readFileSync(artifactPath(run.artifacts_dir, 'feature-contract'), 'utf8');
  const intake = state.feature_intake || {};
  const baseStrategy = decideTestStrategy({
    contractText: contract,
    impactText: fs.readFileSync(artifactPath(run.artifacts_dir, 'feature-impact'), 'utf8'),
    capabilities: caps,
    intake,
  });

  const resolved = resolveTestStrategyWithCapabilities({
    strategy: baseStrategy,
    testCapabilities,
    run,
    root,
  });

  applyResolvedStrategyToPlan(root, run, resolved, intake);

  const gateStatus = run.gates?.['test-capability-setup']?.status;
  const pendingProposals = (resolved.proposals || []).filter((p) => p.kind !== 'e2e');

  if (resolved.needsApproval && pendingProposals.length && !run.gates['test-capability-setup']) {
    run.gates['test-capability-setup'] = {
      status: 'pending',
      updated_at: new Date().toISOString(),
      note: '',
      run_id: run.id,
    };
  }

  if (gateStatus === 'approved' && pendingProposals.length > 0) {
    const setupResult = applyApprovedSetupWithVerification(
      root,
      run.test_capability_proposals || resolved.proposals,
      run
    );
    run.test_capability_setup = setupResult.setup;
    run.test_capability_verifications = setupResult.verifications;
    state.capabilities = detectCapabilities(root);
    state.test_capabilities = detectTestCapabilities(root, state.capabilities);
    if (setupResult.failed) {
      const reResolved = resolveTestStrategyWithCapabilities({
        strategy: baseStrategy,
        testCapabilities: state.test_capabilities,
        run,
        root,
      });
      applyResolvedStrategyToPlan(root, run, reResolved, intake);
      return { ok: true, resolved: reResolved, setupFailed: true, verifications: setupResult.verifications };
    }
  }

  return { ok: true, resolved };
}

function buildWorkflowDecisionContext(root, state, run) {
  const caps = state.capabilities || detectCapabilities(root);
  const testCapabilities = state.test_capabilities || detectTestCapabilities(root, caps);
  const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
  const impactPath = artifactPath(run.artifacts_dir, 'feature-impact');
  const contract = fs.readFileSync(contractPath, 'utf8');
  const impactText = fs.readFileSync(impactPath, 'utf8');
  const intake = state.feature_intake || {};
  const baseStrategy = decideTestStrategy({
    contractText: contract,
    impactText,
    capabilities: caps,
    intake,
  });
  const resolved = resolveTestStrategyWithCapabilities({
    strategy: baseStrategy,
    testCapabilities,
    run,
    root,
  });
  let regressionImpact = { candidates: [] };
  try {
    const impact = generateFeatureImpact(root, run.artifacts_dir, run.id);
    regressionImpact = buildRegressionImpact(root, impact);
  } catch {
    regressionImpact = { candidates: [] };
  }
  return buildDecisionContext(root, state, run, resolved, {
    impactSignals: parseImpactSignals(impactText),
    regressionImpact,
    eosRoot: eosDir(root),
  });
}

/** Rebuild verification-plan scenarios/matrix from the current contract after clarification answers. */
export function resyncVerificationPlanFromContract(root, state, run) {
  if (!run?.artifacts_dir) return null;
  const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
  const planPath = artifactPath(run.artifacts_dir, 'verification-plan');
  if (!fs.existsSync(contractPath) || !fs.existsSync(planPath)) return null;

  const context = buildWorkflowDecisionContext(root, state, run);
  applyResolvedStrategyToPlan(root, run, context.resolved, state.feature_intake || {});
  try {
    fillVerificationMatrix(run.artifacts_dir, state.capabilities || detectCapabilities(root));
  } catch {
    /* matrix fill is best-effort during iterative clarification */
  }
  clearBlockersByType(run, ['plan_bundle']);
  stepPlanBundleValidate(root, state, run);
  return context;
}

const PLAN_RESYNC_ACTIONS = new Set(['answer', 'confirm_testing_strategy', 'confirm_test_cases']);

function stepWorkflowDecisions(root, state, run) {
  const context = buildWorkflowDecisionContext(root, state, run);
  applyResolvedStrategyToPlan(root, run, context.resolved, state.feature_intake || {});

  discoverImplementationDecisions(run, context);

  const pending = getPendingDecisions(run);
  if (pending.length) {
    blockForPendingDecisions(run);
    return { ok: false, reason: 'workflow_decision_required', pending };
  }

  return { ok: true, resolved: context.resolved };
}

export async function handleWorkflowDecisionAnswer(root, home, state, decisionId, optionId, meta = {}) {
  const result = await cmdFeatureContinue(root, home, {
    decision: decisionId,
    option: optionId,
    answer: meta.note || '',
    source: meta.source || 'user',
  });
  const decision = getWorkflowDecision(state.active_run, decisionId);
  return { ...result, decision };
}

export async function handleTestCapabilityGate(root, home, state, { approved = false, rejected = false } = {}) {
  const run = state.active_run;
  if (!run) throw new Error('No active run.');
  const e2eDecision = getWorkflowDecision(run, DECISION_IDS.E2E_AUTOMATION);
  const unitDecision = getWorkflowDecision(run, DECISION_IDS.UNIT_AUTOMATION);

  if (approved) {
    throw new Error(
      'The /feature workflow does not install or configure E2E frameworks. Answer the testing decision in chat (proceed without E2E or wait).'
    );
  }

  if (rejected) {
    const pending =
      e2eDecision?.status === DECISION_STATUS.PENDING
        ? DECISION_IDS.E2E_AUTOMATION
        : unitDecision?.status === DECISION_STATUS.PENDING
          ? DECISION_IDS.UNIT_AUTOMATION
          : null;
    if (!pending) {
      throw new Error('No pending test-capability decision to decline.');
    }
    return cmdFeatureContinue(root, home, {
      decision: pending,
      option: pending === DECISION_IDS.E2E_AUTOMATION ? 'proceed_without_e2e' : 'proceed_without_unit',
    });
  }

  clearBlockersByType(run, ['workflow_decision', 'test_capability', 'test_capability_setup']);
  saveState(root, state);
  if (home) await runPreApprovalPipeline(root, home, state);
  return { ok: true };
}

function scaffoldImplementationPlan(run) {
  const planPath = artifactPath(run.artifacts_dir, 'implementation-plan');
  let content = fs.readFileSync(planPath, 'utf8');
  if (content.includes('_(fill') || content.split('\n').filter((l) => l.match(/^\d+\./)).length < 2) {
    const contract = fs.readFileSync(artifactPath(run.artifacts_dir, 'feature-contract'), 'utf8');
    const ac = extractAcceptanceCriteria(contract);
    const steps = ac.length
      ? ac.map((a, i) => `${i + 1}. Implement: ${a}`)
      : ['1. Implement approved feature scope per contract', '2. Add/update tests per verification plan'];
    if (content.includes('## Implementation steps')) {
      content = content.replace(
        /## Implementation steps[\s\S]*?(?=\n## )/,
        `## Implementation steps\n\n${steps.join('\n')}\n\n`
      );
    }
    markArtifactStatus(planPath, 'ready');
    fs.writeFileSync(planPath, content);
  }
}

function stepPlanBundleValidate(root, state, run) {
  if (hasBlockers(run)) return { ok: false, reason: 'blocked' };
  const result = validatePlanBundle(run, state, eosDir(root));
  if (!result.ok) {
    addBlocker(run, 'plan_bundle', `Incomplete plan bundle: ${result.issues.join(', ')}`);
    return { ok: false, issues: result.issues };
  }
  return { ok: true };
}

export async function runPreApprovalPipeline(root, home, state) {
  const run = state.active_run;
  if (!run) throw new Error('No active run.');
  const orch = initOrchestration(run);
  /** Steps that must re-run on resume to keep decision/blocker state in sync. */
  const REEVALUATE_ON_RESUME = new Set([
    'jira_discovery',
    'figma_discovery',
    'plan_intelligence',
    'test_capability',
    'workflow_decisions',
    'plan_bundle_validate',
  ]);
  const blockerTypes = {
    jira_discovery: ['jira'],
    figma_discovery: ['figma'],
    plan_intelligence: ['plan_intelligence'],
    test_capability: ['test_capability', 'test_capability_setup'],
    workflow_decisions: ['workflow_decision'],
    plan_bundle_validate: ['plan_bundle'],
  };

  const stepRunners = {
    preflight: async () => {
      runPreflight(root, home, state);
      return { ok: true };
    },
    jira_discovery: () => stepJiraDiscovery(root, state, run),
    figma_discovery: () => stepFigmaDiscovery(root, state, run),
    feature_contract: () => stepFeatureContract(root, state, run),
    plan_intelligence: () => stepPlanIntelligence(root, home, state, run),
    test_capability: () => stepTestCapability(root, state, run),
    workflow_decisions: () => stepWorkflowDecisions(root, state, run),
    plan_bundle_validate: () => stepPlanBundleValidate(root, state, run),
  };

  const results = [];
  for (const stepId of PRE_APPROVAL_PIPELINE) {
    if (!REEVALUATE_ON_RESUME.has(stepId) && isStepComplete(orch, stepId)) {
      results.push({ step: stepId, ok: true, resumed: true });
      continue;
    }
    try {
      const types = blockerTypes[stepId] || [];
      if (types.length && run.orchestration) {
        run.orchestration.blockers = run.orchestration.blockers.filter(
          (blocker) => !types.includes(blocker.type)
        );
        run.blocked = run.orchestration.blockers.length > 0;
      }
      const result = await stepRunners[stepId]();
      results.push({ step: stepId, ...result });
      if (result.ok) {
        markStepComplete(orch, stepId);
      } else if (!result.skipped) {
        orch.last_error = result.reason || 'step failed';
        if (REEVALUATE_ON_RESUME.has(stepId)) {
          orch.completed_steps = orch.completed_steps.filter((s) => s !== stepId);
        }
        break;
      } else {
        markStepComplete(orch, stepId);
      }
    } catch (err) {
      addBlocker(run, stepId, err.message);
      results.push({ step: stepId, ok: false, error: err.message });
      break;
    }
  }

  enforceDecisionGate(run);
  if (!hasBlockers(run) && !hasPendingWorkflowDecisions(run)) {
    const workflow = loadWorkflow(home, run.workflow_id);
    advanceRunToPhase(run, workflow, 'approve');
    registerPlanApprovalGate(run);
  } else if (hasPendingWorkflowDecisions(run)) {
    enforceDecisionGate(run);
  }

  saveState(root, state);
  return { results, blocked: hasBlockers(run), blockers: orch.blockers };
}

function registerPlanApprovalGate(run) {
  if (!run.gates['plan-approval']) {
    run.gates['plan-approval'] = {
      status: 'pending',
      updated_at: new Date().toISOString(),
      note: '',
      run_id: run.id,
    };
  }
}

/**
 * Intake text from --context, or from --context-file when the text contains characters the
 * shell would interpret (backticks, $( ), newlines) — which the mutation guard correctly
 * refuses to let through as an inline argument.
 */
export function readContextFlag(root, flags = {}) {
  if (!flags.contextFile) return flags.context;
  const resolved = path.isAbsolute(flags.contextFile)
    ? flags.contextFile
    : path.join(root, flags.contextFile);
  if (!fs.existsSync(resolved)) {
    throw new Error(`--context-file not found: ${flags.contextFile}`);
  }
  const fromFile = fs.readFileSync(resolved, 'utf8').trim();
  if (!fromFile) throw new Error(`--context-file is empty: ${flags.contextFile}`);
  return [flags.context, fromFile].filter(Boolean).join('\n\n');
}

export async function cmdFeatureStart(root, home, flags) {
  let state = loadState(root);
  if (!state) throw new Error('Engineering OS not initialized. Run `eos init` first.');

  const intake = parseFeatureIntake({
    jira: flags.jira,
    figma: flags.figma,
    context: readContextFlag(root, flags),
  });

  state.framework_home = state.framework_home || home;
  const { run, workflow } = startWorkflow({
    frameworkRoot: home,
    eosRoot: eosDir(root),
    state,
    workflowId: 'feature-development',
    artifactsBase: path.join(eosDir(root), 'artifacts'),
  });

  state.feature_intake = intake;
  initOrchestration(run);

  const discoveryPath = artifactPath(run.artifacts_dir, 'discovery-notes');
  let discovery = fs.readFileSync(discoveryPath, 'utf8');
  discovery = applyIntakeToDiscoveryNotes(discovery, intake);
  fs.writeFileSync(discoveryPath, discovery);

  saveState(root, state);

  const pipeline = await runPreApprovalPipeline(root, home, state);
  initFeatureSession(run);
  let resolved = null;
  try {
    resolved = buildWorkflowDecisionContext(root, state, run).resolved;
  } catch {
    resolved = null;
  }
  evaluateFeatureStage(run, resolved);
  saveState(root, state);

  console.log(`Feature workflow: ${workflow.name}`);
  console.log(`Run ID: ${run.id}`);
  console.log(`Artifacts: ${run.artifacts_dir}`);
  if (intake.jira) console.log(`Jira: ${intake.jira.key}`);
  if (intake.figma) console.log(`Figma: ${intake.figma.url}`);

  for (const r of pipeline.results) {
    console.log(`  [${r.ok ? 'ok' : 'FAIL'}] ${r.step}${r.resumed ? ' (resumed)' : ''}${r.skipped ? ' (skipped)' : ''}`);
  }

  const manifest = buildGuardManifest(run);
  console.log('\n--- EOS_GUARD_MANIFEST ---');
  console.log(JSON.stringify(manifest, null, 2));
  console.log('--- END EOS_GUARD_MANIFEST ---');
  console.log('');
  const turn = printFeatureTurn(root, state, resolved, { json: Boolean(flags.json) });
  process.exitCode = 0;
  return {
    blocked: Boolean(run.blocked),
    awaiting: turn.awaiting,
    stage: turn.stage,
    phase: run.current_phase,
    guard: manifest,
    turn,
  };
}

export async function cmdIntelJira(root, home, positional, flags = {}) {
  const state = requireState(root);
  const run = state.active_run;

  if (flags.fromJson) {
    const jsonPath =
      typeof flags.fromJson === 'string' ? flags.fromJson : positional[0];
    if (!jsonPath) throw new Error('Usage: eos intel jira --from-json <path>');
    const result = ingestJiraFromJsonFile(root, run, jsonPath);
    if (run) {
      clearBlockers(run);
      initOrchestration(run);
      markStepComplete(run.orchestration, 'jira_discovery');
      if (result.complete && home) {
        await runPreApprovalPipeline(root, home, state);
      } else {
        saveState(root, state);
      }
      try {
        const resolved = result.complete ? buildWorkflowDecisionContext(root, state, run).resolved : null;
        printFeatureTurn(root, state, resolved);
      } catch {
        /* turn rendering is best-effort after ingest */
      }
    }
    console.log(`Jira ingested from JSON: ${result.normalized.key} (complete=${result.complete})`);
    return { ok: result.complete, normalized: result.normalized, source: 'agent' };
  }

  const input = positional[0] || state.feature_intake?.jira?.raw || state.feature_intake?.jira?.key;
  if (!input) throw new Error('Provide Jira key/URL or start feature with --jira');

  const fetched = await fetchJiraIssue(root, input);
  if (fetched.ok) {
    const normalized = normalizeJiraIssue(fetched.issue, fetched.key, 'rest');
    const result = ingestNormalizedJira(root, run, normalized, { source: 'rest' });
    console.log(`Jira requirements normalized: ${normalized.key} (rest)`);
    return { ok: true, normalized: result.normalized, source: 'rest' };
  }

  const key = fetched.key || extractJiraKey(input);
  const existing = key ? loadNormalizedJira(root, key) : null;
  if (existing && isJiraDiscoveryComplete(existing)) {
    ingestNormalizedJira(root, run, existing, { source: 'agent' });
    console.log(`Jira loaded from cached normalized JSON: ${key}`);
    return { ok: true, normalized: existing, source: 'agent' };
  }

  if (fetched.reason === 'no_config') {
    console.log('Jira REST not configured. Provide normalized JSON: `eos intel jira --from-json <path>`');
    return { ok: false, reason: 'no_config', key };
  }
  throw new Error(`Jira fetch failed: ${fetched.reason}`);
}

export async function cmdIntelFigma(root, home, flags = {}, positional = []) {
  const state = requireState(root);
  const run = state.active_run;
  const url = state.feature_intake?.figma?.url;

  if (flags.fromJson) {
    const jsonPath =
      typeof flags.fromJson === 'string' ? flags.fromJson : positional[0];
    if (!jsonPath) throw new Error('Usage: eos intel figma --from-json <path>');
    const result = ingestFigmaFromJsonFile(root, run, jsonPath, url);
    if (run) {
      if (result.complete) {
        clearBlockers(run);
        markStepComplete(initOrchestration(run), 'figma_discovery');
        if (home) await runPreApprovalPipeline(root, home, state);
      } else {
        addBlocker(
          run,
          'figma',
          `Figma discovery incomplete: ${(result.errors || []).join(', ')}`
        );
        saveState(root, state);
      }
    }
    if (!result.complete) {
      console.error(`Figma discovery incomplete: ${(result.errors || []).join(', ')}`);
      process.exitCode = 1;
    } else {
      console.log(`Figma discovery ingested (complete=${result.complete})`);
    }
    return { ok: result.complete, normalized: result.normalized, errors: result.errors };
  }

  if (!url) {
    console.log('No Figma URL in feature intake.');
    return { ok: true, skipped: true };
  }

  const existing = loadFigmaDiscovery(root);
  if (existing && isFigmaDiscoveryComplete(existing)) {
    console.log('Figma discovery already complete.');
    return { ok: true, normalized: existing };
  }

  console.log('Figma discovery required. Use agent/MCP and `eos intel figma --from-json <path>`.');
  return { ok: false, reason: 'figma_incomplete', url };
}

export function cmdOrchestratePlan(root, home) {
  const state = requireState(root);
  const run = state.active_run;
  if (!run || run.status !== 'active') throw new Error('No active run.');
  if (run.workflow_id !== 'feature-development') {
    throw new Error('orchestrate-plan is for feature-development workflow only.');
  }

  const caps = state.capabilities || detectCapabilities(root);
  const artifactsDir = run.artifacts_dir;
  const intake = state.feature_intake || {};

  const impact = generateFeatureImpact(root, artifactsDir, run.id);
  writeFeatureImpact(artifactsDir, impact);

  const contractPath = artifactPath(artifactsDir, 'feature-contract');
  const contract = fs.readFileSync(contractPath, 'utf8');
  const needQuery = intake.context?.slice(0, 80) || 'feature components';
  const reuse = rankReuse(root, needQuery);
  writeReuseAnalysis(artifactsDir, reuse, run.id);

  scaffoldBackendDependency(root, artifactsDir, run.id);

  const regressionImpact = buildRegressionImpact(root, impact);
  const impactPath = artifactPath(artifactsDir, 'feature-impact');
  let impactContent = fs.readFileSync(impactPath, 'utf8');
  if (!impactContent.includes('## Regression blast radius')) {
    impactContent = `${impactContent.trim()}\n\n${renderRegressionBlastRadiusSection(regressionImpact)}`;
    fs.writeFileSync(impactPath, impactContent);
  }

  const impactText = impactContent;
  const strategy = decideTestStrategy({
    contractText: contract,
    impactText,
    capabilities: caps,
    intake,
  });
  const regressionStrategy = decideRegressionStrategy({
    regressionImpact,
    capabilities: caps,
    featureStrategy: strategy,
  });
  const unitScenarios = generateUnitScenarios({ contractText: contract, strategy });
  const e2eScenarios = generateE2eScenarios({ contractText: contract, strategy, intake });
  const manualScenarios = generateManualScenarios({ contractText: contract, strategy });
  const regressionScenarios = generateRegressionScenarios({ regressionImpact, regressionStrategy });
  const qaScope = generateQaRegressionScope({ regressionScenarios, regressionStrategy });
  const strategySection = renderTestStrategySection(strategy);
  const scenariosSection = renderTestScenariosSection(unitScenarios, e2eScenarios, manualScenarios);

  let planPath = artifactPath(artifactsDir, 'verification-plan');
  let planContent = fs.readFileSync(planPath, 'utf8');
  planContent = applyTestStrategyToVerificationPlan(planContent, strategySection);
  planContent = applyTestScenariosToPlan(planContent, scenariosSection);
  planContent = applyRegressionSectionsToPlan(planContent, [
    ['## Regression Strategy', renderRegressionStrategySection(regressionStrategy)],
    ['## Regression Scenarios', renderRegressionScenariosSection(regressionScenarios, { required: regressionStrategy.required })],
    ['## QA Regression Scope', renderQaRegressionScopeSection(qaScope)],
    ['## Regression Test Implementation', renderRegressionTestImplementationPlaceholder()],
  ]);
  fs.writeFileSync(planPath, planContent);

  fillVerificationMatrix(artifactsDir, caps);
  markArtifactStatus(planPath, 'ready');

  if (run.orchestration) markStepComplete(run.orchestration, 'plan_intelligence');
}


export function cmdPlanBundle(root, home) {
  const state = requireState(root);
  const run = state.active_run;
  if (!run) throw new Error('No active run.');
  const result = validatePlanBundle(run, state, eosDir(root));

  console.log('# Feature approval bundle');
  console.log(`Run: ${run.id}`);
  console.log(`Phase: ${run.current_phase}`);
  console.log(`Blocked: ${hasBlockers(run) ? 'yes' : 'no'}`);
  console.log('');

  for (const [id, ok] of Object.entries(result.artifactStatus)) {
    console.log(`- ${id}: ${ok ? 'ok' : 'INCOMPLETE'}`);
  }

  if (!result.ok || hasBlockers(run)) {
    console.log('');
    if (result.issues.length) console.log(`Issues: ${result.issues.join(', ')}`);
    if (hasBlockers(run)) {
      for (const b of run.orchestration?.blockers || []) {
        console.log(`Blocker: ${b.type} — ${b.reason}`);
      }
    }
    process.exitCode = 1;
  } else {
    console.log('\nAll bundle artifacts complete. Run `eos gate plan-approval --approve`.');
  }
  return result;
}

export function printOrchestrationForPhase(phaseId) {
  console.log('## Orchestration (automatic in `eos feature`)');
  console.log('');
  console.log(renderOrchestrationManifest(phaseId));
}
