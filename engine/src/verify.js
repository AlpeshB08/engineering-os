import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { artifactPath } from './artifacts.js';
import { detectCapabilities, detectRunnableCommands } from './detect.js';
import {
  classifyTestExecutionFailure,
  detectTestCapabilities,
  enrichRunnableCommands,
  FAILURE_CLASS,
} from './intelligence/testCapabilities.js';
import { isFigmaDiscoveryComplete, loadFigmaDiscovery } from './integrations/figma.js';
import { hasBlockers } from './orchestration.js';
import { renderDecisionAuditSection, isBackendDecisionResolved, getWorkflowDecision, DECISION_IDS, hasPendingWorkflowDecisions } from './workflowDecisions.js';
import {
  buildRequirementCoverage,
  findUnresolvedRequirements,
  parseEvidenceRunId,
  parseTestImplementation,
  parseTestScenarios,
  parseTestStrategy,
  summarizeCoverage,
} from './requirementVerification.js';
import { validateVerificationPlanTestPlanning } from './intelligence/testStrategy.js';
import { parseRegressionStrategyFromPlan } from './intelligence/regressionImpact.js';
import {
  runPostImplementationRegressionReconciliation,
  applyReconciliationToEvidence,
  applyReconciliationToPlan,
  renderPostImplementationRegressionTable,
} from './intelligence/regressionReconciliation.js';
import { validatePlanBundle } from './artifacts.js';
import {
  buildRegressionCoverage,
  regressionGateSatisfied,
  summarizeRegressionCoverage,
} from './regressionVerification.js';
import {
  VERIFICATION_STATE,
  DELIVERY_STATUS,
  normalizeVerificationState,
  satisfiesVerificationGate,
} from './verificationStates.js';
import { consumerRoot, eosDir } from './paths.js';
import { requireState, saveState } from './state.js';

const FINAL_STATUSES = [
  DELIVERY_STATUS.READY_FOR_REVIEW,
  DELIVERY_STATUS.NOT_READY,
  DELIVERY_STATUS.BLOCKED,
  DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING,
];

/**
 * Execute the repository's engineering checks.
 *
 * `options.strategy` is the confirmed testing strategy for the run. When it says a test
 * kind is not required, that command is skipped rather than executed: running E2E after
 * the user explicitly chose "proceed without E2E" produces a failure that contradicts
 * their own decision and is reported as if it mattered.
 */
export function runEngineeringChecks(root, capabilities, testCapabilities = null, options = {}) {
  const caps = testCapabilities || detectTestCapabilities(root, capabilities);
  let commands = detectRunnableCommands(root, capabilities);
  commands = enrichRunnableCommands(commands, caps);
  const strategy = options.strategy;
  if (strategy) {
    commands = commands.filter((check) => {
      if (check.capability === 'e2e-tests' && !strategy.e2e?.required) return false;
      if (check.capability === 'unit-tests' && strategy.unit?.required === false && strategy.unit?.skipExecution) {
        return false;
      }
      return true;
    });
  }
  const results = [];
  for (const check of commands) {
    if (!check.include) continue;
    try {
      const out = execSync(check.command, {
        cwd: root,
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 120000,
      });
      results.push({
        name: check.name,
        command: check.command,
        status: 'Passed',
        exitCode: 0,
        output: out.slice(-2000),
        failureClass: null,
      });
    } catch (err) {
      const output = (err.stdout || err.stderr || err.message || '').slice(-2000);
      const classification = classifyTestExecutionFailure({
        name: check.name,
        output,
        exitCode: err.status ?? 1,
        command: check.command,
      });
      const status =
        classification.kind === FAILURE_CLASS.INFRASTRUCTURE
          ? 'Infrastructure Failed'
          : 'Failed';
      results.push({
        name: check.name,
        command: check.command,
        status,
        exitCode: err.status ?? 1,
        output,
        failureClass: classification.kind,
        failureSummary: classification.summary,
        requiresApprovalToRepair: classification.requiresApprovalToRepair,
      });
    }
  }
  return results;
}

function areaStatus(ok, partial = false) {
  if (ok) return '✓ Complete';
  if (partial) return '⚠️ Partial';
  return '✗ Missing';
}

export function computeWorkflowAreaSummary(ctx) {
  const {
    run,
    coverage = [],
    strategy = {},
    plan = '',
    contract = '',
    evidence = '',
    checks = [],
    intake = {},
    eosRoot = '',
    state = {},
    finalStatus = 'NOT READY',
  } = ctx;

  const counts = summarizeCoverage(coverage);
  const planning = validateVerificationPlanTestPlanning(plan, contract);
  const regressionStrategy = parseRegressionStrategyFromPlan(plan);
  const scenarios = parseTestScenarios(plan);
  const testImpls = parseTestImplementation(plan);
  const regressionCoverage = buildRegressionCoverage({
    planText: plan,
    evidenceText: evidence,
    runId: run?.id || '',
  });
  const regressionCounts = summarizeRegressionCoverage(regressionCoverage);
  const regressionGate = regressionGateSatisfied(regressionCoverage, regressionStrategy);
  const bundle =
    run && state
      ? validatePlanBundle(run, state, eosRoot)
      : { ok: planning.ok, issues: planning.issues };

  const requirementsOk =
    coverage.length > 0 &&
    contract.includes('## Acceptance Criteria') &&
    counts.Missing === 0 &&
    counts.Partial === 0;
  const designOk =
    !intake?.figma?.url ||
    Boolean(loadFigmaDiscovery(ctx.root || path.dirname(eosRoot))?.discovery?.complete);
  const impactOk = plan.includes('## Verification matrix');

  const testStrategyOk =
    /Unit Tests:\s*(Required|Not Required)/i.test(plan) &&
    /E2E Tests:\s*(Required|Not Required)/i.test(plan) &&
    /Manual QA:\s*(Required|Not Required)/i.test(plan);
  const unitE2eOk = testStrategyOk;
  const scenariosOk = planning.ok && scenarios.some((s) => s.scenarioId);

  const automatedRequired = strategy.unitRequired || strategy.e2eRequired;
  const automatedScenarios = scenarios.filter((s) => /-T\d+$|-E\d+$/i.test(s.scenarioId || ''));
  const testImplOk =
    !automatedRequired ||
    (automatedScenarios.length > 0 &&
      automatedScenarios.every((s) =>
        testImpls.some((t) => t.scenarioId === s.scenarioId && t.file?.trim())
      ));

  const testExecOk =
    !automatedRequired ||
    (coverage.length > 0 &&
      coverage.every((c) => satisfiesVerificationGate(c.executionState)));
  const acEvidenceOk = coverage.length > 0 && counts.Implemented === coverage.length;
  const implEvidenceOk =
    coverage.length > 0 && coverage.every((c) => c.implementationEvidence?.repositoryVerified);

  const regressionImpactOk = plan.includes('## Regression Strategy');
  const postImplReconciledOk =
    !regressionStrategy.required ||
    evidence.includes('## Post-Implementation Regression Reconciliation');
  const regressionStrategyOk =
    regressionStrategy.required === false ||
    (plan.includes('## Regression Strategy') && planning.regression?.ok !== false);
  const regressionScenariosOk =
    !regressionStrategy.required || (planning.regression?.scenarios?.length || 0) > 0;
  const regressionImplOk =
    !regressionStrategy.required ||
    !regressionStrategy.automatedRequired ||
    regressionCoverage.filter((c) => !c.notRequired).every((c) => c.implemented || !c.planned);
  const regressionExecOk = !regressionStrategy.required || regressionGate.ok;
  const regressionVerificationOk = regressionExecOk;
  const qaScopeOk =
    !regressionStrategy.required ||
    !regressionStrategy.manualRequired ||
    (planning.regression?.qaScope?.length || 0) > 0;

  const rows = [
    { area: 'Requirements', status: areaStatus(requirementsOk, counts.Partial > 0) },
    { area: 'Design', status: areaStatus(designOk, Boolean(intake?.figma?.url && !designOk)) },
    { area: 'Impact Analysis', status: areaStatus(impactOk, !impactOk && Boolean(plan)) },
    { area: 'Test Strategy', status: areaStatus(testStrategyOk && bundle.ok, !bundle.ok && testStrategyOk) },
    { area: 'Unit/E2E Decision', status: areaStatus(unitE2eOk, false) },
    { area: 'Test Scenarios', status: areaStatus(scenariosOk, scenarios.length > 0 && !planning.ok) },
    { area: 'Regression Impact', status: areaStatus(regressionImpactOk, regressionStrategy.required && !regressionImpactOk) },
    { area: 'Post-Implementation Regression', status: areaStatus(postImplReconciledOk, regressionStrategy.required && !postImplReconciledOk) },
    { area: 'Regression Strategy', status: areaStatus(regressionStrategyOk, regressionStrategy.required && !regressionStrategyOk) },
    { area: 'Regression Scenarios', status: areaStatus(regressionScenariosOk, regressionStrategy.required && !regressionScenariosOk) },
    { area: 'QA Regression Scope', status: areaStatus(qaScopeOk, regressionStrategy.manualRequired && !qaScopeOk) },
    { area: 'Test Implementation', status: areaStatus(testImplOk, automatedRequired && !testImplOk) },
    { area: 'Regression Implementation', status: areaStatus(regressionImplOk, regressionStrategy.automatedRequired && !regressionImplOk) },
    { area: 'Test Execution', status: areaStatus(testExecOk, coverage.some((c) => c.executionState === 'NotRun')) },
    { area: 'Regression Execution', status: areaStatus(regressionExecOk, regressionStrategy.required && !regressionExecOk) },
    { area: 'AC Evidence', status: areaStatus(acEvidenceOk, counts.Partial > 0) },
    { area: 'Regression Verification', status: areaStatus(regressionVerificationOk, regressionStrategy.required && !regressionVerificationOk) },
    { area: 'Implementation Evidence', status: areaStatus(implEvidenceOk, counts.Partial > 0) },
    { area: 'Final Status', status: finalStatus },
  ];

  return rows;
}

function renderWorkflowSummaryTable(rows) {
  const header = '| Area | Status |\n| --- | --- |';
  const body = rows.map((r) => `| ${r.area} | ${r.status} |`).join('\n');
  return `${header}\n${body}`;
}

function testExecutionStatus(required, checks, name, strategy = {}) {
  if (!required) return VERIFICATION_STATE.NOT_APPLICABLE;
  const ran = checks.filter((c) => c.name === name);
  if (!ran.length) {
    if (name === 'e2e' && strategy.manualQaFallback) return VERIFICATION_STATE.MANUAL_REQUIRED;
    if (name === 'e2e' && strategy.e2eUnavailable) return VERIFICATION_STATE.NOT_AVAILABLE;
    return VERIFICATION_STATE.NOT_RUN;
  }
  return ran.some((c) => c.status === 'Failed')
    ? VERIFICATION_STATE.FAIL
    : VERIFICATION_STATE.PASS;
}

export function computeFinalStatus(ctx) {
  const {
    run,
    coverage,
    strategy,
    checks,
    evidence,
    backend,
    intake,
    eosRoot,
    root,
    plan = '',
    contract = '',
  } = ctx;

  const implementationComplete = run.completed_phases?.includes('implement');
  const verificationPhasesPending =
    !run.completed_phases?.includes('verify') || run.current_phase === 'verify';

  const orchestrationBlockers = (run.orchestration?.blockers || []).filter(
    (blocker) => !(run.current_phase === 'verify' && blocker.type === 'verification')
  );
  if (orchestrationBlockers.length) {
    return { status: DELIVERY_STATUS.BLOCKED, reasons: ['Run has orchestration blockers'] };
  }

  if (hasPendingWorkflowDecisions(run)) {
    return {
      status: DELIVERY_STATUS.BLOCKED,
      reasons: ['Unresolved workflow decisions require explicit user input'],
    };
  }

  if (intake?.jira?.key) {
    const jiraPath = path.join(eosRoot, 'integrations', `jira-${intake.jira.key}.json`);
    if (!fs.existsSync(jiraPath)) {
      return { status: DELIVERY_STATUS.BLOCKED, reasons: ['Required Jira normalized data missing'] };
    }
    const j = JSON.parse(fs.readFileSync(jiraPath, 'utf8'));
    if (!j.discovery?.complete) {
      return { status: DELIVERY_STATUS.BLOCKED, reasons: ['Required Jira discovery incomplete'] };
    }
  }

  if (intake?.figma?.url) {
    const figma = loadFigmaDiscovery(root || path.dirname(eosRoot));
    if (!figma || !isFigmaDiscoveryComplete(figma)) {
      return { status: DELIVERY_STATUS.BLOCKED, reasons: ['Required Figma discovery incomplete'] };
    }
  }

  const gateFailure = (gateId) => {
    const gate = run.gates?.[gateId];
    if (gate?.status !== 'approved') return `${gateId} not approved`;
    if (!gate.run_id || gate.run_id !== run.id) {
      return `${gateId} is missing or stale for current run`;
    }
    return null;
  };
  const requiredGateIds = ['plan-approval', 'contract-approval'];
  if (run.flags?.architectural_impact) requiredGateIds.push('architecture-approval');
  const gateFailures = requiredGateIds.map(gateFailure).filter(Boolean);
  if (gateFailures.length) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: gateFailures,
    };
  }

  const backendNeedsWork =
    /needs backend per contract heuristics: yes/i.test(backend) &&
    /\*\*Backend availability:\*\* unknown/i.test(backend);
  const backendDecision = getWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY);
  if (backendNeedsWork) {
    if (!isBackendDecisionResolved(run)) {
      return {
        status: DELIVERY_STATUS.BLOCKED,
        reasons: ['Unresolved backend dependency — explicit workflow decision required'],
      };
    }
    if (backendDecision?.selectedOption === 'wait_for_backend') {
      return {
        status: DELIVERY_STATUS.BLOCKED,
        reasons: ['Workflow decision: waiting for backend support before API-dependent implementation'],
      };
    }
  }

  const e2eDecision = run.workflow_decisions?.['e2e-automation'];
  const manualQaFallback =
    run.gates?.['test-capability-setup']?.status === 'rejected' ||
    e2eDecision?.selectedOption === 'manual_qa';
  const e2eUnavailable = /E2E Tests:\s*Required \(pending setup approval\)/i.test(plan);
  const enrichedStrategy = { ...strategy, manualQaFallback, e2eUnavailable };

  const evidenceRunId = parseEvidenceRunId(evidence);
  if (evidenceRunId && evidenceRunId !== run.id) {
    return {
      status: DELIVERY_STATUS.NOT_READY,
      reasons: [`verification evidence Run ID (${evidenceRunId}) does not match current run (${run.id})`],
    };
  }

  const planRunId = parseEvidenceRunId(plan);
  if (!planRunId || planRunId !== run.id) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: ['verification plan is missing or stale for current run'],
    };
  }

  const planning = validateVerificationPlanTestPlanning(plan, contract);
  if (!planning.ok) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: planning.issues.map((issue) => `verification plan: ${issue}`),
    };
  }

  if (!implementationComplete) {
    return {
      status: DELIVERY_STATUS.NOT_READY,
      reasons: ['Implementation phase is not completed'],
    };
  }

  const setupGate = run.gates?.['test-capability-setup'];
  if (setupGate?.status === 'approved') {
    const setupKinds = [
      ...(strategy.unitRequired ? ['unit'] : []),
      ...(strategy.e2eRequired ? ['e2e'] : []),
    ];
    const incompleteSetup = setupKinds.filter(
      (kind) => run.test_capability_verification?.[kind]?.status !== 'ready'
    );
    if (incompleteSetup.length) {
      return {
        status: DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING,
        reasons: incompleteSetup.map((kind) => `${kind} test setup validation is incomplete`),
      };
    }
  }

  const counts = summarizeCoverage(coverage);
  const failedChecks = checks.filter((c) => c.status === 'Failed');
  const infraChecks = checks.filter((c) => c.status === 'Infrastructure Failed');

  if (implementationComplete && verificationPhasesPending && counts.Missing > 0) {
    return {
      status: DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING,
      reasons: ['Implementation complete — verification evidence incomplete'],
    };
  }

  if (counts.Missing > 0 || counts.Partial > 0) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: findUnresolvedRequirements(coverage),
    };
  }

  if (infraChecks.length) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: infraChecks.map(
        (c) =>
          `${c.name}: ${c.failureSummary || 'infrastructure/environment failure (not a test assertion failure)'}`
      ),
    };
  }

  if (failedChecks.length) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: failedChecks.map((c) => `${c.name} failed`),
    };
  }

  const unitExec = testExecutionStatus(strategy.unitRequired, checks, 'unit tests', enrichedStrategy);
  if (strategy.unitRequired && unitExec === VERIFICATION_STATE.NOT_RUN) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: ['Required unit tests not executed'],
    };
  }

  const e2eExec = testExecutionStatus(strategy.e2eRequired, checks, 'e2e', enrichedStrategy);
  if (strategy.e2eRequired) {
    if (e2eExec === VERIFICATION_STATE.NOT_RUN) {
      return {
        status: implementationComplete
          ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
          : DELIVERY_STATUS.NOT_READY,
        reasons: ['Required E2E tests not executed'],
      };
    }
    if (e2eExec === VERIFICATION_STATE.MANUAL_REQUIRED && !evidence.includes('## Manual check')) {
      return {
        status: DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING,
        reasons: ['Manual QA required — E2E not configured; manual evidence incomplete'],
      };
    }
    if (e2eExec === VERIFICATION_STATE.NOT_AVAILABLE && !manualQaFallback) {
      return {
        status: DELIVERY_STATUS.BLOCKED,
        reasons: ['E2E unavailable — explicit E2E setup or Manual QA decision required'],
      };
    }
  }

  const notImplemented = coverage.filter((c) => c.status !== 'Implemented');
  if (notImplemented.length) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: findUnresolvedRequirements(notImplemented),
    };
  }

  const badExecution = coverage.filter(
    (c) => !satisfiesVerificationGate(normalizeVerificationState(c.executionState))
  );
  if (badExecution.length) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: findUnresolvedRequirements(badExecution),
    };
  }

  const regressionStrategy = parseRegressionStrategyFromPlan(plan);
  const regressionCoverage = buildRegressionCoverage({
    planText: plan,
    evidenceText: evidence,
    runId: run.id,
  });
  const regressionGate = regressionGateSatisfied(regressionCoverage, regressionStrategy);
  if (!regressionGate.ok) {
    return {
      status: implementationComplete
        ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
        : DELIVERY_STATUS.NOT_READY,
      reasons: regressionGate.reasons,
    };
  }

  if (coverage.length > 0 && counts.Implemented === coverage.length && !failedChecks.length) {
    return { status: DELIVERY_STATUS.READY_FOR_REVIEW, reasons: [] };
  }

  return {
    status: implementationComplete
      ? DELIVERY_STATUS.IMPLEMENTED_BUT_VERIFICATION_PENDING
      : DELIVERY_STATUS.NOT_READY,
    reasons: ['Requirements not fully verified'],
  };
}

export function cmdVerifyRun(root, { silent = false } = {}) {
  const state = requireState(root);
  const run = state.active_run;
  if (!run) throw new Error('No active run.');
  const caps = state.capabilities || detectCapabilities(root);
  const testCaps = state.test_capabilities || detectTestCapabilities(root, caps);
  const results = runEngineeringChecks(root, caps, testCaps);

  const evidencePath = artifactPath(run.artifacts_dir, 'verification-evidence');
  let content = fs.existsSync(evidencePath)
    ? fs.readFileSync(evidencePath, 'utf8')
    : '# Verification Evidence\n\n<!-- EOS_ARTIFACT_STATUS: draft -->\n';

  if (!content.includes(`**Run ID:** ${run.id}`)) {
    if (content.includes('**Run ID:**')) {
      content = content.replace(/\*\*Run ID:\*\*\s*\S+/, `**Run ID:** ${run.id}`);
    } else {
      content = content.replace(
        /^# Verification Evidence/m,
        `# Verification Evidence\n\n- **Run ID:** ${run.id}`
      );
    }
  }

  const block = ['## Test execution', '', '```text'];
  for (const r of results) {
    block.push(`$ ${r.command}`);
    block.push(`exit: ${r.exitCode} — ${r.status}`);
    if (r.output) block.push(r.output.trim());
    block.push('');
  }
  if (!results.length) block.push('(no automated checks executed)');
  block.push('```');

  if (content.includes('## Test execution')) {
    content = content.replace(
      /## Test execution[\s\S]*?(?=\n## Scenario coverage|\n## Manual check|\n## Failures)/,
      `${block.join('\n')}\n\n`
    );
  } else {
    content += `\n\n${block.join('\n')}\n`;
  }

  fs.writeFileSync(evidencePath, content);
  if (!silent) {
    console.log('Verification run complete:');
    for (const r of results) {
      console.log(`  ${r.name}: ${r.status}`);
    }
    console.log(`Evidence: ${evidencePath}`);
  }
  return { results, evidencePath };
}

function renderCoverageReport(coverage) {
  if (!coverage.length) return '- _(no acceptance criteria parsed)_';
  return coverage
    .map((c) => {
      const impl = c.implementationEvidence;
      const implLine = impl?.repositoryVerified
        ? `impl: ${impl.file}${impl.symbol ? `#${impl.symbol}` : ''} (repository-verified)`
        : `impl: ${impl?.reason || 'not verified'}`;
      return `- **${c.acId}** ${c.requirement}: **${c.status}** | ${implLine} | scenario: ${c.testScenarioEvidence || '—'} | execution: ${c.executionState}${c.testExecutionEvidence ? ` (${c.testExecutionEvidence})` : ''}`;
    })
    .join('\n');
}

export function cmdVerifyReport(root, { silent = false } = {}) {
  const state = requireState(root);
  const run = state.active_run;
  if (!run) throw new Error('No active run.');
  const dir = run.artifacts_dir;
  const eosRootPath = eosDir(root);
  const repoRoot = consumerRoot(root);

  const contract = fs.readFileSync(artifactPath(dir, 'feature-contract'), 'utf8');
  let plan = fs.readFileSync(artifactPath(dir, 'verification-plan'), 'utf8');
  const evidencePath = artifactPath(dir, 'verification-evidence');
  let evidence = fs.existsSync(evidencePath) ? fs.readFileSync(evidencePath, 'utf8') : '';
  const reviewPath = artifactPath(dir, 'review-notes');
  const review = fs.existsSync(reviewPath) ? fs.readFileSync(reviewPath, 'utf8') : '';
  const backend = fs.readFileSync(artifactPath(dir, 'backend-dependency'), 'utf8');
  const deliveryPath = artifactPath(dir, 'delivery-preparation');

  let jiraNormalized = null;
  if (state.feature_intake?.jira?.key) {
    const jiraPath = path.join(eosRootPath, 'integrations', `jira-${state.feature_intake.jira.key}.json`);
    if (fs.existsSync(jiraPath)) {
      jiraNormalized = JSON.parse(fs.readFileSync(jiraPath, 'utf8'));
    }
  }

  const strategy = parseTestStrategy(plan);
  const regressionStrategy = parseRegressionStrategyFromPlan(plan);
  const reconciliation = runPostImplementationRegressionReconciliation({
    root: repoRoot,
    planText: plan,
    run,
    regressionStrategy,
  });

  if (regressionStrategy.required) {
    plan = applyReconciliationToPlan(plan, reconciliation, regressionStrategy);
    evidence = applyReconciliationToEvidence(evidence, reconciliation);
    fs.writeFileSync(artifactPath(dir, 'verification-plan'), plan);
    fs.writeFileSync(evidencePath, evidence);
  } else if (!evidence.includes('## Post-Implementation Regression Reconciliation')) {
    evidence = applyReconciliationToEvidence(evidence, reconciliation);
    fs.writeFileSync(evidencePath, evidence);
  }

  const caps = state.capabilities || detectCapabilities(root);
  const testCaps = state.test_capabilities || detectTestCapabilities(root, caps);
  const checks = runEngineeringChecks(root, caps, testCaps);
  const regressionCoverage = buildRegressionCoverage({
    planText: plan,
    evidenceText: evidence,
    runId: run.id,
  });
  const regressionGate = regressionGateSatisfied(regressionCoverage, regressionStrategy);
  const coverage = buildRequirementCoverage({
    contractText: contract,
    planText: plan,
    evidenceText: evidence,
    reviewText: review,
    jiraNormalized,
    strategy,
    consumerRoot: repoRoot,
    runId: run.id,
  });

  const { status: finalStatus, reasons } = computeFinalStatus({
    run,
    coverage,
    strategy,
    checks,
    evidence,
    backend,
    intake: state.feature_intake,
    eosRoot: eosRootPath,
    root,
    plan,
    contract,
  });

  const summaryRows = computeWorkflowAreaSummary({
    run,
    coverage,
    strategy,
    plan,
    contract,
    evidence,
    checks,
    intake: state.feature_intake,
    eosRoot: eosRootPath,
    root,
    state,
    finalStatus,
  });

  const e2eDecision = run.workflow_decisions?.['e2e-automation'];
  const manualQaFallback =
    run.gates?.['test-capability-setup']?.status === 'rejected' ||
    e2eDecision?.selectedOption === 'manual_qa';
  const e2eUnavailable = /E2E Tests:\s*Required \(pending setup approval\)/i.test(plan);
  const enrichedStrategy = { ...strategy, manualQaFallback, e2eUnavailable };
  const unitExec = testExecutionStatus(strategy.unitRequired, checks, 'unit tests', enrichedStrategy);
  const e2eExec = testExecutionStatus(strategy.e2eRequired, checks, 'e2e', enrichedStrategy);

  const report = `# Final Verification Report

- **Run ID:** ${run.id}
- **Final Status:** ${finalStatus}

## Feature completion summary

${renderWorkflowSummaryTable(summaryRows)}

${renderDecisionAuditSection(run)}

## Post-Implementation Regression Impact

${renderPostImplementationRegressionTable(reconciliation.rows).split('\n').slice(1).join('\n')}

- Planned regression scenarios: ${reconciliation.plannedScenarios.map((s) => s.regId).join(', ') || '—'}
- Newly discovered regression scenarios: ${reconciliation.newlyDiscovered.map((s) => s.regId).join(', ') || '—'}
- Reconciled regression scope: ${reconciliation.reconciledScenarios.map((s) => s.regId).join(', ') || '—'}
- QA regression scope items: ${reconciliation.qaScope.map((s) => s.regId).filter(Boolean).join(', ') || '—'}
- Regression verification: ${regressionGate.ok ? 'Complete' : 'Incomplete'}

## Requirement coverage

${renderCoverageReport(coverage)}

## Test execution

- Unit tests: ${unitExec}${strategy.unitRequired ? '' : ' (not required)'}
- E2E tests: ${e2eExec}${strategy.e2eRequired ? '' : ' (not required)'}
- E2E available: ${enrichedStrategy.e2eUnavailable ? 'no' : strategy.e2eRequired ? 'yes/pending' : 'n/a'}
- Manual QA fallback: ${manualQaFallback ? 'explicit' : 'not selected'}

## Engineering validation

${checks.length ? checks.map((c) => `- ${c.name}: ${c.status}`).join('\n') : '- No checks executed'}

## Status reasons

${reasons.length ? reasons.map((r) => `- ${r}`).join('\n') : '- All applicable checks satisfied'}

## Final status

\`\`\`
${finalStatus}
\`\`\`
`;

  let delivery = fs.existsSync(deliveryPath)
    ? fs.readFileSync(deliveryPath, 'utf8')
    : '# Delivery Preparation\n\n<!-- EOS_ARTIFACT_STATUS: draft -->\n';

  if (delivery.includes('## Final verification report')) {
    delivery = delivery.replace(
      /## Final verification report[\s\S]*$/,
      `## Final verification report\n\n${report.split('# Final Verification Report')[1].trim()}\n`
    );
  } else {
    delivery += `\n\n## Final verification report\n\n${report.split('# Final Verification Report')[1].trim()}\n`;
  }

  fs.writeFileSync(deliveryPath, delivery);
  run.verification_result = {
    run_id: run.id,
    status: finalStatus,
    reasons,
    verified_at: new Date().toISOString(),
  };
  saveState(root, state);
  if (!silent) console.log(report);
  return { finalStatus, report, reasons, coverage, summaryRows };
}

export { FINAL_STATUSES };
