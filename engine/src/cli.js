#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { artifactPath, markArtifactStatus, validatePlanBundle } from './artifacts.js';
import {
  detectArchetype,
  detectCapabilities,
  renderRepositoryProfile,
} from './detect.js';
import {
  analyzeChangeImpact,
  buildContextPack,
  buildKnowledgeIndex,
  decideTestStrategy,
  generateFeatureImpact,
  generateGraphs,
  generateE2eScenarios,
  generateManualScenarios,
  generateUnitScenarios,
  rankReuse,
  renderChangeImpactMarkdown,
  renderTestStrategySection,
  renderTestScenariosSection,
  runIntelScan,
  scaffoldKnowledgeEntry,
  scaffoldBackendDependency,
  searchKnowledge,
  writeFeatureImpact,
  writeReuseAnalysis,
  fillVerificationMatrix,
  applyTestStrategyToVerificationPlan,
  applyTestScenariosToPlan,
} from './intelligence/index.js';
import {
  buildRegressionImpact,
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
  cmdFeatureStart,
  cmdFeatureContinue,
  cmdIntelJira,
  cmdIntelFigma,
  cmdOrchestratePlan,
  cmdPlanBundle,
  handleTestCapabilityGate,
  handleWorkflowDecisionAnswer,
  printOrchestrationForPhase,
} from './feature.js';
import { preserveCompletionAndCleanup, renderCompletionReport } from './featureLifecycle.js';
import {
  getPendingDecisions,
  getAnsweredDecisions,
  renderPendingDecisionsMessage,
  hasPendingWorkflowDecisions,
} from './workflowDecisions.js';
import { hasBlockers } from './orchestration.js';
import { cmdVerifyRun, cmdVerifyReport } from './verify.js';
import {
  consumerRoot,
  eosDir,
  ensureDir,
  fileExists,
  frameworkHome,
  statePath,
} from './paths.js';
import { defaultState, loadState, requireState, saveState } from './state.js';
import { die, nowIso, printJson } from './util.js';
import {
  buildGuardManifest,
  buildHookAllowResponse,
  buildHookDenyResponse,
  evaluateGuardHookRequest,
  evaluateMutationAuthorization,
  isEosInitialized,
  isImplementationPermitted,
} from './guard.js';
import { buildEnforcementCapabilitiesReport } from './mutationEnforcement.js';
import { validateConsumerState, validateFramework } from './validate.js';
import {
  ensureConsumerGitignore,
  executeCleanup,
  renderRecommendedGitignore,
} from './cleanup.js';
import {
  abortRun,
  completePhase,
  currentStep,
  listWorkflows,
  loadPhaseMarkdown,
  loadWorkflow,
  missingArtifacts,
  pendingRequiredGates,
  registerPhaseGates,
  setArchitecturalImpact,
  startWorkflow,
} from './workflow.js';

function usage() {
  return `Engineering OS CLI (eos)

Usage:
  eos init
  eos detect
  eos start <workflow>
  eos feature [--jira KEY|URL] [--figma URL] [--context "..."] [--context-file <path>]
  eos feature continue --answer "..." [--decision id --option id]
  eos feature continue --confirm testing-strategy|test-cases|manual-qa|regression|review|delivery
  eos feature continue --implemented [--summary "..."] [--tests-created "a,b"]
  eos feature orchestrate-plan
  eos feature plan-bundle
  eos status [--json]
  eos next
  eos gate <id> --approve|--reject [--note "..."]
  eos decision list [--json]
  eos decision answer <id> --option <optionId> [--note "..."]
  eos complete-phase [--force]
  eos guard implementation [--path <file>] [--json]
  eos guard hook [--shell|--mcp]
  eos guard capabilities [--json]
  eos set-flag architectural_impact <true|false>
  eos abort-run
  eos cleanup [--dry-run] [--run <run-id>]
  eos mark-artifact <artifact-id> <status>
  eos validate [--framework]
  eos workflows

Intelligence:
  eos intel scan
  eos intel graphs
  eos intel impact
  eos intel reuse <query>
  eos intel change-impact <path>
  eos intel jira [KEY|URL] [--from-json <path>]
  eos intel figma [--from-json <path>]
  eos intel verify-matrix
  eos intel backend
  eos intel test-strategy
  eos verify run
  eos verify report
  eos context [phase]
  eos knowledge index
  eos knowledge search <query>
  eos knowledge add <type> <title>

  eos help
`;
}

function parseArgs(argv) {
  const args = argv.slice(2);
  const command = args[0] || 'help';
  const positional = [];
  const flags = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '--json') flags.json = true;
    else if (a === '--framework') flags.framework = true;
    else if (a === '--force') flags.force = true;
    else if (a === '--approve') flags.approve = true;
    else if (a === '--reject') flags.reject = true;
    else if (a === '--note') flags.note = args[++i];
    else if (a.startsWith('--note=')) flags.note = a.slice('--note='.length);
    else if (a === '--jira') flags.jira = args[++i];
    else if (a.startsWith('--jira=')) flags.jira = a.slice('--jira='.length);
    else if (a === '--figma') flags.figma = args[++i];
    else if (a.startsWith('--figma=')) flags.figma = a.slice('--figma='.length);
    else if (a === '--option') flags.option = args[++i];
    else if (a.startsWith('--option=')) flags.option = a.slice('--option='.length);
    else if (a === '--source') flags.source = args[++i];
    else if (a === '--context') flags.context = args[++i];
    else if (a.startsWith('--context=')) flags.context = a.slice('--context='.length);
    // Ticket and design text routinely contains backticks and $( ), which the shell would
    // execute. Reading it from a file keeps intake out of shell quoting entirely.
    else if (a === '--context-file') flags.contextFile = args[++i];
    else if (a.startsWith('--context-file=')) flags.contextFile = a.slice('--context-file='.length);
    else if (a === '--answer') flags.answer = args[++i];
    else if (a.startsWith('--answer=')) flags.answer = a.slice('--answer='.length);
    else if (a === '--confirm') flags.confirm = args[++i];
    else if (a.startsWith('--confirm=')) flags.confirm = a.slice('--confirm='.length);
    else if (a === '--decision') flags.decision = args[++i];
    else if (a.startsWith('--decision=')) flags.decision = a.slice('--decision='.length);
    else if (a === '--question') flags.question = args[++i];
    else if (a.startsWith('--question=')) flags.question = a.slice('--question='.length);
    else if (a === '--implemented') flags.implemented = true;
    else if (a === '--summary') flags.summary = args[++i];
    else if (a.startsWith('--summary=')) flags.summary = a.slice('--summary='.length);
    else if (a === '--tests-created') flags.testsCreated = args[++i];
    else if (a.startsWith('--tests-created=')) flags.testsCreated = a.slice('--tests-created='.length);
    else if (a === '--from-json') {
      const next = args[i + 1];
      flags.fromJson = next && !next.startsWith('--') ? args[++i] : true;
    } else if (a.startsWith('--from-json=')) flags.fromJson = a.slice('--from-json='.length);
    else if (a === '--path') flags.path = args[++i];
    else if (a.startsWith('--path=')) flags.path = a.slice('--path='.length);
    else if (a === '--shell') flags.shell = true;
    else if (a === '--mcp') flags.mcp = true;
    else if (a === '--dry-run') flags.dryRun = true;
    else if (a === '--run') flags.run = args[++i];
    else if (a.startsWith('--run=')) flags.run = a.slice('--run='.length);
    else positional.push(a);
  }
  return { command, positional, flags };
}

function writeProfile(root, capabilities, archetype) {
  const dir = eosDir(root);
  ensureDir(dir);
  const content = renderRepositoryProfile({ root, capabilities, archetype });
  fs.writeFileSync(path.join(dir, 'repository-profile.md'), content);

  const gitignoreHint = path.join(dir, 'recommended-gitignore.txt');
  fs.writeFileSync(gitignoreHint, renderRecommendedGitignore());
}

function cmdInit(root, home) {
  const dir = eosDir(root);
  ensureDir(dir);
  ensureDir(path.join(dir, 'artifacts'));
  ensureDir(path.join(dir, 'knowledge-base'));
  ensureDir(path.join(dir, 'intelligence'));

  let state = loadState(root);
  if (!state) state = defaultState();
  state.framework_home = home;
  const capabilities = detectCapabilities(root);
  const archetype = detectArchetype(capabilities);
  state.capabilities = capabilities;
  state.archetype = archetype;
  saveState(root, state);
  writeProfile(root, capabilities, archetype);
  const gitignore = ensureConsumerGitignore(root);

  const readme = path.join(dir, 'README.md');
  if (!fileExists(readme)) {
    fs.writeFileSync(
      readme,
      `# Engineering OS (consumer workspace)

This directory is managed by the Engineering OS CLI (\`eos\`).

- Run \`eos status\` / \`eos next\` for the active workflow phase
- Run \`eos intel scan\` for Project DNA
- Run \`eos context\` for slim phase context packs
- Artifacts live under \`artifacts/\`; intelligence under \`intelligence/\`

Framework home: \`${home}\`
`
    );
  }

  console.log(`Initialized Engineering OS in ${dir}`);
  console.log(`Archetype: ${archetype}`);
  console.log(`State: ${statePath(root)}`);
  console.log('Tip: run `eos intel scan` for Project DNA, then `eos feature` to start.');
  console.log(`Git integration: see ${path.join(dir, 'recommended-gitignore.txt')}`);
  console.log(`Gitignore: ${gitignore.changed ? 'updated' : 'already configured'} (${gitignore.path})`);
}

function cmdCleanup(root, flags) {
  const result = executeCleanup(root, {
    dryRun: Boolean(flags.dryRun),
    runId: flags.run || null,
  });
  if (flags.json) {
    printJson(result);
    return;
  }
  console.log(`Cleanup ${result.dryRun ? '(dry-run)' : 'complete'}`);
  if (result.notes.length) {
    console.log('\nNotes:');
    for (const n of result.notes) console.log(`  - ${n}`);
  }
  if (result.toPreserve.length) {
    console.log(`\nPreserved (${result.toPreserve.length}):`);
    for (const p of result.toPreserve) {
      console.log(`  + ${path.relative(root, p.path)}`);
    }
  }
  if (result.removed.length) {
    console.log(`\n${result.dryRun ? 'Would remove' : 'Removed'} (${result.removed.length}):`);
    for (const r of result.removed) {
      console.log(`  - ${path.relative(root, r.path)}`);
    }
  } else {
    console.log('\nNo runtime artifacts to remove.');
  }
  if (result.stateChanges.length && !result.dryRun) {
    console.log('\nState changes:');
    for (const c of result.stateChanges) console.log(`  - ${c.type}: ${c.runId}`);
  }
  if (result.errors.length) {
    console.error('\nErrors:');
    for (const e of result.errors) console.error(`  ! ${e}`);
    process.exit(1);
  }
}

function cmdDetect(root, home) {
  const state = requireState(root);
  const capabilities = detectCapabilities(root);
  const archetype = detectArchetype(capabilities);
  state.capabilities = capabilities;
  state.archetype = archetype;
  state.framework_home = state.framework_home || home;
  saveState(root, state);
  writeProfile(root, capabilities, archetype);
  console.log(`Updated repository profile (${archetype})`);
  const present = Object.entries(capabilities)
    .filter(([, v]) => v.present)
    .map(([k]) => k);
  console.log(`Capabilities: ${present.join(', ') || '(none detected)'}`);
}

function cmdStart(root, home, workflowId) {
  if (!workflowId) die('Usage: eos start <workflow>');
  const state = requireState(root);
  state.framework_home = state.framework_home || home;
  const { run, workflow } = startWorkflow({
    frameworkRoot: home,
    eosRoot: eosDir(root),
    state,
    workflowId,
    artifactsBase: path.join(eosDir(root), 'artifacts'),
  });
  saveState(root, state);
  console.log(`Started workflow: ${workflow.name} (${workflow.id})`);
  console.log(`Run ID: ${run.id}`);
  console.log(`Artifacts: ${run.artifacts_dir}`);
  console.log(`Current phase: ${run.current_phase}`);
  console.log('Next: run `eos next`');
}

function statusPayload(root, home, state) {
  const run = state.active_run;
  if (!run || run.status !== 'active') {
    return {
      initialized: true,
      archetype: state.archetype,
      capabilities: state.capabilities,
      active_run: run || null,
      message:
        run?.status === 'completed'
          ? 'Last run completed.'
          : 'No active run. Start with `eos start <workflow>`.',
    };
  }
  const workflow = loadWorkflow(home, run.workflow_id);
  const step = currentStep(workflow, run);
  registerPhaseGates(run, step);
  const missing = missingArtifacts(run, step, eosDir(root), state);
  const pending = pendingRequiredGates(run, step).filter((g) => {
    if (g === 'architecture-approval' && (step.gates || []).includes(g)) {
      return Boolean(run.flags?.architectural_impact);
    }
    return true;
  });
  return {
    initialized: true,
    archetype: state.archetype,
    run_id: run.id,
    workflow_id: run.workflow_id,
    phase: run.current_phase,
    phase_index: run.phase_index,
    artifacts_dir: run.artifacts_dir,
    flags: run.flags,
    gates: run.gates,
    missing_artifacts: missing,
    pending_gates: pending,
    pending_decisions: getPendingDecisions(run),
    answered_decisions: getAnsweredDecisions(run),
    blocked: hasBlockers(run) || hasPendingWorkflowDecisions(run),
    implementation_permitted: isImplementationPermitted(run).ok,
    orchestration_blockers: run.orchestration?.blockers || [],
    completed_phases: run.completed_phases,
    read_only: Boolean(workflow.read_only),
    has_project_dna: fileExists(path.join(eosDir(root), 'intelligence', 'project-dna.md')),
  };
}

function cmdStatus(root, home, flags) {
  const state = requireState(root);
  const payload = statusPayload(root, home, state);
  if (flags.json) printJson(payload);
  else {
    console.log('Engineering OS status');
    console.log(`  Archetype: ${payload.archetype}`);
    console.log(`  Project DNA: ${payload.has_project_dna ? 'yes' : 'no (run eos intel scan)'}`);
    if (!payload.run_id) {
      console.log(`  ${payload.message}`);
      return;
    }
    console.log(`  Run: ${payload.run_id}`);
    console.log(`  Workflow: ${payload.workflow_id}`);
    console.log(`  Phase: ${payload.phase} (index ${payload.phase_index})`);
    console.log(`  Artifacts: ${payload.artifacts_dir}`);
    console.log(
      `  Architectural impact: ${payload.flags?.architectural_impact ? 'yes' : 'no'}`
    );
    console.log('  Gates:');
    for (const [id, g] of Object.entries(payload.gates || {})) {
      console.log(`    - ${id}: ${g.status}`);
    }
    if (payload.missing_artifacts?.length) {
      console.log(
        `  Missing/incomplete artifacts: ${payload.missing_artifacts.join(', ')}`
      );
    } else {
      console.log('  Artifacts: ok for current phase requirements (or none required)');
    }
    if (payload.pending_gates?.length) {
      console.log(`  Pending gates: ${payload.pending_gates.join(', ')}`);
    }
    if (payload.pending_decisions?.length) {
      console.log('  Pending workflow decisions:');
      for (const d of payload.pending_decisions) {
        console.log(`    - ${d.id}: ${d.question}`);
        for (const o of d.options || []) {
          console.log(`        · ${o.label}`);
        }
        if (d.answerType === 'free_text' || !d.options?.length) {
          console.log('        · Reply in this chat with the missing information');
        }
      }
    }
    if (payload.orchestration_blockers?.length) {
      console.log('  Orchestration blockers:');
      for (const b of payload.orchestration_blockers) {
        console.log(`    - ${b.type}: ${b.reason.split('\n')[0]}`);
      }
    }
  }
}

function cmdNext(root, home) {
  const state = requireState(root);
  const run = state.active_run;
  if (!run || run.status !== 'active') {
    console.log('No active run. Start one with `eos start <workflow>`.');
    console.log(`Available workflows: ${listWorkflows(home).join(', ')}`);
    return;
  }
  const workflow = loadWorkflow(home, run.workflow_id);
  const step = currentStep(workflow, run);
  registerPhaseGates(run, step);
  saveState(root, state);

  const missing = missingArtifacts(run, step, eosDir(root), state);
  const pending = pendingRequiredGates(run, step).filter((g) => {
    if (g === 'architecture-approval' && (step.gates || []).includes(g)) {
      return Boolean(run.flags?.architectural_impact);
    }
    return true;
  });

  let contextPath = null;
  try {
    const pack = buildContextPack({
      root,
      frameworkHome: home,
      state,
      workflow,
      phaseId: step.id,
    });
    contextPath = pack.path;
  } catch (err) {
    contextPath = null;
    console.error(`(context pack warning: ${err.message})`);
  }

  const phaseDoc = loadPhaseMarkdown(home, step.id);
  console.log(`# Engineering OS — Next Instructions`);
  console.log('');
  console.log(`Workflow: **${workflow.name}** (\`${workflow.id}\`)`);
  console.log(`Run: \`${run.id}\``);
  console.log(`Phase: **${step.id}**`);
  console.log(`Artifacts dir: \`${run.artifacts_dir}\``);
  console.log(`Read-only workflow: ${workflow.read_only ? 'yes' : 'no'}`);
  console.log('');
  if (contextPath) {
    console.log('## Context pack (prefer this over full-repo scan)');
    console.log(`\`${contextPath}\``);
    console.log('');
  }
  console.log('## Principles reminder');
  console.log('- Discover before implementing; reuse before creating.');
  console.log('- Never assume backend or missing capabilities.');
  console.log('- Stop at human gates; do not bypass approvals.');
  console.log('');
  console.log('## Intelligence helpers');
  if (!fileExists(path.join(eosDir(root), 'intelligence', 'project-dna.md'))) {
    console.log('- Project DNA missing → run `eos intel scan`');
  }
  if (workflow.id === 'feature-development') {
    printOrchestrationForPhase(step.id);
    console.log('');
  }
  if (step.id === 'plan' || step.id === 'discover') {
    console.log('- Orchestrated via `eos feature` — see manifest above');
  }
  if (step.id === 'intel-scan') {
    console.log('- Run `eos intel scan` then `eos intel graphs`');
  }
  console.log('- `eos context` to refresh the slim context pack');
  console.log('');
  console.log('## Blockers');
  const pendingDecisions = getPendingDecisions(run);
  const orchBlockers = run.orchestration?.blockers || [];
  if (!missing.length && !pending.length && !pendingDecisions.length && !orchBlockers.length) {
    console.log('- None for current checks. Complete phase work, then `eos complete-phase`.');
  } else {
    if (missing.length) console.log(`- Artifacts: ${missing.join(', ')}`);
    if (pending.length) {
      console.log(`- Gates: ${pending.join(', ')}`);
      console.log('  Human must run: `eos gate <id> --approve`');
    }
    if (pendingDecisions.length) {
      console.log('- Workflow decisions (explicit user input required):');
      console.log(renderPendingDecisionsMessage(run));
    }
    if (orchBlockers.length) {
      for (const b of orchBlockers) {
        console.log(`- ${b.type}: ${b.reason.split('\n')[0]}`);
      }
    }
  }
  console.log('');
  console.log('## Phase instructions');
  console.log('');
  console.log(phaseDoc);
  console.log('');
  console.log('## Repository profile');
  console.log(`Read: \`${path.join(eosDir(root), 'repository-profile.md')}\``);
  console.log('');
  console.log('## After finishing this phase');
  console.log('1. Ensure required artifacts are filled (not placeholders).');
  console.log('2. Obtain any required gate approvals.');
  console.log('3. Run `eos complete-phase`.');
  console.log('4. Run `eos next` again.');
}

async function cmdGate(root, home, gateId, flags) {
  if (!gateId) die('Usage: eos gate <id> --approve|--reject [--note "..."]');
  if (!flags.approve && !flags.reject) die('Specify --approve or --reject');
  if (flags.approve && flags.reject) die('Use only one of --approve or --reject');
  const state = requireState(root);
  const run = state.active_run;
  if (!run || run.status !== 'active') die('No active run.');
  if (gateId === 'plan-approval' && flags.approve) {
    if (hasPendingWorkflowDecisions(run)) {
      console.error('Plan approval blocked — unresolved workflow decisions require explicit user input:');
      console.error(renderPendingDecisionsMessage(run));
      process.exit(1);
    }
    const bundle = validatePlanBundle(run, state, eosDir(root));
    if (!bundle.ok) {
      console.error('Plan approval blocked — verification/plan bundle invalid:');
      for (const issue of bundle.issues) console.error(`  - ${issue}`);
      process.exit(1);
    }
  }
  run.gates[gateId] = {
    status: flags.approve ? 'approved' : 'rejected',
    updated_at: nowIso(),
    note: flags.note || '',
    run_id: run.id,
  };
  saveState(root, state);

  if (gateId === 'test-capability-setup') {
    await handleTestCapabilityGate(root, home, state, {
      approved: Boolean(flags.approve),
      rejected: Boolean(flags.reject),
    });
  }

  console.log(`Gate ${gateId} => ${run.gates[gateId].status}`);
}

function cmdDecisionList(root, flags) {
  const state = requireState(root);
  const run = state.active_run;
  if (!run) die('No active run.');
  const pending = getPendingDecisions(run);
  const answered = getAnsweredDecisions(run);
  if (flags.json) {
    printJson({ pending, answered });
    return;
  }
  console.log('Workflow decisions');
  if (!pending.length && !answered.length) {
    console.log('  (none)');
    return;
  }
  if (pending.length) {
    console.log('\nPending:');
    console.log(renderPendingDecisionsMessage(run));
  }
  if (answered.length) {
    console.log('\nAnswered:');
    for (const d of answered) {
      const selected = d.options.find((o) => o.id === d.selectedOption)?.label || d.selectedOption;
      console.log(`  - ${d.id}: ${selected} (${d.source || 'user'})`);
    }
  }
}

async function cmdDecisionAnswer(root, home, decisionId, flags) {
  if (!decisionId) die('Usage: eos decision answer <id> --option <optionId> [--note "..."]');
  if (!flags.option) die('Specify --option <optionId>');
  const state = requireState(root);
  const result = await handleWorkflowDecisionAnswer(root, home, state, decisionId, flags.option, {
    source: flags.source || 'user',
    note: flags.note || '',
  });
  const selected = result.decision?.selectedOption || flags.option;
  console.log(`Decision ${decisionId} => ${selected}`);
  if (state.active_run?.blocked) {
    console.log('Status: still BLOCKED — additional decisions or steps may be required.');
  } else {
    console.log('Workflow resumed from blocked step.');
  }
}

function cmdGuardCapabilities(root, flags) {
  let run = null;
  if (isEosInitialized(root)) {
    const state = loadState(root);
    run = state?.active_run || null;
  }
  const report = buildEnforcementCapabilitiesReport(root, run);
  if (flags.json) {
    printJson(report);
  } else {
    console.log('Engineering OS mutation enforcement capabilities');
    console.log(`  Effective tier: ${report.consumer.effective_tier}`);
    console.log(
      `  Current adapter hard enforcement: ${report.enforcement.current_adapter_hard_enforcement ? 'yes' : 'no'}`
    );
    console.log(`  Engine-only enforcement: ${report.enforcement.engine_only_enforcement ? 'yes' : 'no'}`);
    console.log(
      `  IDE-independent hard enforcement: ${report.enforcement.ide_independent_hard_enforcement ? 'yes' : 'no'}`
    );
    console.log(`  ${report.honesty.statement}`);
    console.log('');
    console.log('Authorization invariant:');
    for (const condition of report.engine.invariant.conditions) {
      console.log(`  - ${condition}`);
    }
    console.log('');
    console.log('Adapter profiles:');
    for (const adapter of report.adapters) {
      console.log(
        `  - ${adapter.name}: hard hooks=${adapter.hard_mutation_interception_available ? 'yes' : 'no'}, effective=${adapter.effective_enforcement_when_fully_installed}`
      );
      if (adapter.limitation) console.log(`      ${adapter.limitation}`);
    }
  }
  return report;
}

function cmdGuard(root, home, positional, flags) {
  const sub = positional[0];
  if (sub === 'capabilities') return cmdGuardCapabilities(root, flags);
  if (sub === 'hook' || flags.hook) {
    cmdGuardHook(root, flags);
    return;
  }
  if (sub !== 'implementation') {
    die('Usage: eos guard <implementation|hook|capabilities> [--json]');
  }

  const eosInitialized = isEosInitialized(root);
  if (!eosInitialized) {
    if (flags.json) {
      printJson({ permitted: true, reason: 'Engineering OS not initialized — guard inactive.', scope: 'inactive' });
      return { ok: true };
    }
    console.log('Guard inactive — Engineering OS not initialized.');
    return { ok: true };
  }

  const state = requireState(root);
  const run = state.active_run;
  const paths = [];
  for (let i = 1; i < positional.length; i++) {
    if (positional[i] === '--path') paths.push(positional[++i]);
    else paths.push(positional[i]);
  }
  if (flags.path) paths.push(flags.path);

  if (!paths.length) {
    const permission = run
      ? isImplementationPermitted(run)
      : { ok: false, reason: 'No active governed workflow run.' };
    const payload = {
      permitted: permission.ok,
      reason: permission.reason || null,
      ...buildGuardManifest(run),
    };
    if (flags.json) printJson(payload);
    else {
      console.log(`Implementation permitted: ${permission.ok ? 'yes' : 'no'}`);
      if (permission.reason) console.log(`Reason: ${permission.reason}`);
      if (run) {
        console.log(`Phase: ${run.current_phase}`);
        const pending = getPendingDecisions(run);
        if (pending.length) {
          console.log('Pending decisions:');
          console.log(renderPendingDecisionsMessage(run));
        }
      }
    }
    if (!permission.ok) process.exitCode = 1;
    return permission;
  }

  for (const filePath of paths) {
    const check = evaluateMutationAuthorization({ root, filePath, run, eosInitialized });
    if (!check.ok) {
      const payload = {
        permitted: false,
        path: filePath,
        reason: check.reason,
        phase: check.phase,
        pending_decisions: check.pending_decisions || [],
      };
      if (flags.json) printJson(payload);
      else {
        console.error(`Mutation blocked for ${filePath}: ${check.reason}`);
        if (check.pending_decisions?.length) {
          console.error(`Pending decisions: ${check.pending_decisions.join(', ')}`);
        }
      }
      process.exitCode = 1;
      return check;
    }
  }

  const payload = { permitted: true, paths };
  if (flags.json) printJson(payload);
  else console.log(`Mutation permitted for: ${paths.join(', ')}`);
  return { ok: true };
}

function cmdGuardHook(root, flags) {
  let input = '';
  try {
    input = fs.readFileSync(0, 'utf8');
  } catch {
    console.log(JSON.stringify(buildHookDenyResponse('Guard hook failed to read input — application mutation denied (fail-closed).')));
    process.exit(2);
    return;
  }

  let payload;
  try {
    payload = JSON.parse(input || '{}');
  } catch {
    console.log(JSON.stringify(buildHookDenyResponse('Guard hook received invalid JSON — application mutation denied (fail-closed).')));
    process.exit(2);
    return;
  }

  const hookKind = flags.shell || payload.hook_event === 'beforeShellExecution'
    ? 'shell'
    : flags.mcp || payload.hook_event === 'beforeMCPExecution'
      ? 'mcp'
      : 'tool';

  const eosInitialized = isEosInitialized(root);
  let run = null;
  if (eosInitialized) {
    const state = loadState(root);
    run = state?.active_run || null;
  }

  const result = evaluateGuardHookRequest({ payload, root, run, eosInitialized, hookKind });
  if (!result.ok) {
    console.log(JSON.stringify(buildHookDenyResponse(result.reason, {
      phase: result.phase,
      path: result.path,
      pending_decisions: result.pending_decisions,
      fail_closed: result.failClosed || true,
    })));
    process.exit(2);
    return;
  }

  console.log(JSON.stringify(buildHookAllowResponse()));
}

function cmdCompletePhase(root, home, flags) {
  const state = requireState(root);
  const result = completePhase({
    frameworkRoot: home,
    eosRoot: eosDir(root),
    state,
    force: Boolean(flags.force),
  });
  if (!result.ok) {
    console.error('Cannot complete phase.');
    if (result.missing?.length) {
      console.error(`Missing/incomplete artifacts: ${result.missing.join(', ')}`);
    }
    if (result.pendingGates?.length) {
      console.error(`Pending gates: ${result.pendingGates.join(', ')}`);
    }
    if (result.reason) console.error(result.reason);
    process.exit(1);
  }
  saveState(root, state);
  if (result.completed) {
    console.log(`Workflow complete: ${result.run.workflow_id} (${result.run.id})`);
    if (result.run.workflow_id === 'feature-development') {
      const finalized = preserveCompletionAndCleanup(root, state, result.run);
      const cleanup = finalized.cleanup;
      if (finalized.cleanupError || cleanup?.errors?.length) {
        console.error('Automatic cleanup failed; the completed run remains available for inspection.');
        for (const error of finalized.cleanupError ? [finalized.cleanupError] : cleanup.errors) {
          console.error(`  ! ${error}`);
        }
        console.error(`Retry safely with: eos cleanup --run ${result.run.id}`);
        process.exitCode = 1;
        return;
      }
      console.log(`Automatic cleanup removed ${cleanup.removed.length} temporary artifact(s).`);
      if (cleanup.toPreserve.length) {
        console.log(`Preserved ${cleanup.toPreserve.length} durable/project artifact(s).`);
      }
      if (finalized.completion) {
        console.log('');
        console.log(renderCompletionReport(finalized.completion));
      }
    }
  } else {
    console.log(`Completed phase: ${result.step.id}`);
    console.log(`Next phase: ${result.next.id}`);
    console.log('Run `eos next` for instructions.');
  }
}

function cmdValidate(root, home, flags) {
  if (flags.framework) {
    const res = validateFramework(home);
    if (res.warnings.length) console.log('Warnings:\n- ' + res.warnings.join('\n- '));
    if (!res.ok) {
      console.error('Framework validation failed:\n- ' + res.errors.join('\n- '));
      process.exit(1);
    }
    console.log('Framework validation OK');
    return;
  }
  const state = loadState(root);
  const fres = validateFramework(home);
  const cres = validateConsumerState(state);
  const errors = [...fres.errors, ...cres.errors];
  if (errors.length) {
    console.error('Validation failed:\n- ' + errors.join('\n- '));
    process.exit(1);
  }
  console.log('Validation OK');
}

function cmdMarkArtifact(root, artifactId, status) {
  if (!artifactId || !status) die('Usage: eos mark-artifact <artifact-id> <status>');
  const state = requireState(root);
  const run = state.active_run;
  if (!run || run.status !== 'active') die('No active run.');
  let file;
  if (artifactId === 'repository-profile') {
    file = path.join(eosDir(root), 'repository-profile.md');
  } else if (artifactId === 'project-dna') {
    file = path.join(eosDir(root), 'intelligence', 'project-dna.md');
  } else {
    file = artifactPath(run.artifacts_dir, artifactId);
  }
  if (!fileExists(file)) die(`Artifact not found: ${file}`);
  markArtifactStatus(file, status);
  console.log(`Marked ${artifactId} => ${status}`);
  console.log(`File: ${file}`);
}

function cmdSetFlag(root, flagName, value) {
  const state = requireState(root);
  const run = state.active_run;
  if (!run || run.status !== 'active') die('No active run.');
  if (flagName !== 'architectural_impact') die('Supported flag: architectural_impact');
  const bool = ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
  setArchitecturalImpact(run, bool);
  saveState(root, state);
  console.log(`Flag architectural_impact = ${bool}`);
}

async function cmdIntel(root, home, positional, flags) {
  const sub = positional[0];
  if (!sub) die('Usage: eos intel <scan|graphs|impact|reuse|change-impact|jira|figma|verify-matrix|backend|test-strategy>');
  const state = requireState(root);

  if (sub === 'jira') {
    return cmdIntelJira(root, home, positional.slice(1), flags);
  }

  if (sub === 'figma') {
    return cmdIntelFigma(root, home, flags, positional.slice(1));
  }

  if (sub === 'verify-matrix') {
    const run = state.active_run;
    if (!run?.artifacts_dir) die('No active run.');
    const caps = state.capabilities || detectCapabilities(root);
    const result = fillVerificationMatrix(run.artifacts_dir, caps);
    console.log(`Verification matrix filled: ${result.path} (${result.rowCount} rows)`);
    return;
  }

  if (sub === 'backend') {
    const run = state.active_run;
    if (!run?.artifacts_dir) die('No active run.');
    const result = scaffoldBackendDependency(root, run.artifacts_dir, run.id);
    console.log(`Backend dependency scaffolded: ${result.path} (availability: ${result.availability})`);
    return;
  }

  if (sub === 'test-strategy') {
    const run = state.active_run;
    if (!run?.artifacts_dir) die('No active run.');
    const caps = state.capabilities || detectCapabilities(root);
    const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
    const impactPath = artifactPath(run.artifacts_dir, 'feature-impact');
    const contract = fs.readFileSync(contractPath, 'utf8');
    const impactText = fileExists(impactPath) ? fs.readFileSync(impactPath, 'utf8') : '';
    const impact = generateFeatureImpact(root, run.artifacts_dir, run.id);
    const regressionImpact = buildRegressionImpact(root, impact);
    const strategy = decideTestStrategy({
      contractText: contract,
      impactText,
      capabilities: caps,
      intake: state.feature_intake || {},
    });
    const regressionStrategy = decideRegressionStrategy({
      regressionImpact,
      capabilities: caps,
      featureStrategy: strategy,
    });
    const unitScenarios = generateUnitScenarios({ contractText: contract, strategy });
    const e2eScenarios = generateE2eScenarios({
      contractText: contract,
      strategy,
      intake: state.feature_intake || {},
    });
    const manualScenarios = generateManualScenarios({ contractText: contract, strategy });
    const regressionScenarios = generateRegressionScenarios({ regressionImpact, regressionStrategy });
    const qaScope = generateQaRegressionScope({ regressionScenarios, regressionStrategy });
    const strategySection = renderTestStrategySection(strategy);
    const scenariosSection = renderTestScenariosSection(unitScenarios, e2eScenarios, manualScenarios);
    const planPath = artifactPath(run.artifacts_dir, 'verification-plan');
    let plan = fs.readFileSync(planPath, 'utf8');
    plan = applyTestStrategyToVerificationPlan(plan, strategySection);
    plan = applyTestScenariosToPlan(plan, scenariosSection);
    plan = applyRegressionSectionsToPlan(plan, [
      ['## Regression Strategy', renderRegressionStrategySection(regressionStrategy)],
      ['## Regression Scenarios', renderRegressionScenariosSection(regressionScenarios, { required: regressionStrategy.required })],
      ['## QA Regression Scope', renderQaRegressionScopeSection(qaScope)],
      ['## Regression Test Implementation', renderRegressionTestImplementationPlaceholder()],
    ]);
    fs.writeFileSync(planPath, plan);
    console.log(`Test strategy written: ${planPath}`);
    console.log(`  Unit: ${strategy.unit.required ? 'Required' : 'Not Required'}`);
    console.log(`  E2E: ${strategy.e2e.required ? 'Required' : 'Not Required'}`);
    return;
  }

  if (sub === 'scan') {
    const result = runIntelScan(root, home);
    const state = requireState(root);
    state.capabilities = result.capabilities;
    state.archetype = result.archetype;
    state.intelligence = {
      dna_path: result.outputs.dnaJson,
      scanned_at: result.dna.scanned_at,
      file_count: result.dna.file_count,
    };
    saveState(root, state);
    writeProfile(root, result.capabilities, result.archetype);
    console.log(`Project DNA written (${result.archetype}, ${result.dna.file_count} files)`);
    console.log(`  ${result.outputs.dnaMd}`);
    console.log(`  ${result.outputs.reuseInventory}`);
    console.log(`  ${result.outputs.capabilityMatrix}`);
    console.log(`  ${result.outputs.architectureSummary}`);
    console.log(`  ${result.outputs.knownRisks}`);
    console.log(`  ${result.outputs.standardsSummary}`);
    return;
  }

  if (sub === 'graphs') {
    const outs = generateGraphs(root);
    console.log('Dependency graphs generated:');
    for (const [name, paths] of Object.entries(outs)) {
      console.log(`  ${name}: ${paths.mmdPath}`);
    }
    return;
  }

  if (sub === 'impact') {
    const state = requireState(root);
    const run = state.active_run;
    if (!run || run.status !== 'active') die('No active run. Start a workflow first.');
    const impact = generateFeatureImpact(root, run.artifacts_dir, run.id);
    const out = writeFeatureImpact(run.artifacts_dir, impact);
    console.log(`Feature impact written: ${out}`);
    console.log(`Keywords: ${impact.keywords.join(', ') || '(none)'}`);
    return;
  }

  if (sub === 'reuse') {
    const query = positional.slice(1).join(' ');
    if (!query) die('Usage: eos intel reuse <query>');
    const result = rankReuse(root, query);
    const state = loadState(root);
    if (state?.active_run?.artifacts_dir) {
      const out = writeReuseAnalysis(state.active_run.artifacts_dir, result, state.active_run.id);
      console.log(`Reuse analysis written: ${out}`);
    }
    if (flags.json) printJson(result);
    else {
      console.log(`Recommendation: ${result.recommendation}`);
      console.log(result.rationale);
      console.log('Top candidates:');
      for (const c of result.candidates.slice(0, 10)) {
        console.log(`  [${c.score}] ${c.decision} ${c.path} (${c.kind})`);
      }
    }
    return;
  }

  if (sub === 'change-impact') {
    const target = positional[1];
    if (!target) die('Usage: eos intel change-impact <path>');
    const result = analyzeChangeImpact(root, target);
    if (flags.json) printJson(result);
    else console.log(renderChangeImpactMarkdown(result));
    return;
  }

  die(`Unknown intel subcommand: ${sub}`);
}

function cmdContext(root, home, positional) {
  const state = requireState(root);
  const run = state.active_run;
  const phaseId = positional[0] || run?.current_phase || 'bootstrap';
  let workflow = null;
  if (run?.workflow_id) workflow = loadWorkflow(home, run.workflow_id);
  const pack = buildContextPack({
    root,
    frameworkHome: home,
    state,
    workflow: workflow || { id: 'adhoc' },
    phaseId,
  });
  console.log(`Context pack: ${pack.path} (${pack.bytes} bytes)`);
}

function cmdKnowledge(root, home, positional, flags) {
  const sub = positional[0];
  if (!sub) die('Usage: eos knowledge <index|search|add>');
  if (sub === 'index') {
    const { index } = buildKnowledgeIndex(home, root);
    console.log(`Indexed ${index.count} knowledge entries`);
    return;
  }
  if (sub === 'search') {
    const query = positional.slice(1).join(' ');
    if (!query) die('Usage: eos knowledge search <query>');
    const hits = searchKnowledge(home, root, query, 15);
    if (flags.json) printJson(hits);
    else if (!hits.length) console.log('No matches.');
    else {
      for (const h of hits) {
        console.log(`[${h.score}] ${h.type}: ${h.title}`);
        console.log(`      ${h.path} (${h.source})`);
        if (h.summary) console.log(`      ${h.summary}`);
      }
    }
    return;
  }
  if (sub === 'add') {
    const type = positional[1];
    const title = positional.slice(2).join(' ');
    if (!type || !title) die('Usage: eos knowledge add <type> <title>');
    const file = scaffoldKnowledgeEntry(root, type, title);
    console.log(`Created: ${file}`);
    console.log('Run `eos knowledge index` after editing.');
    return;
  }
  die(`Unknown knowledge subcommand: ${sub}`);
}

function cmdFeature(root, home, positional, flags) {
  const sub = positional[0];
  if (sub === 'orchestrate-plan') {
    cmdOrchestratePlan(root, home);
    return Promise.resolve();
  }
  if (sub === 'plan-bundle') {
    cmdPlanBundle(root, home);
    return Promise.resolve();
  }
  if (sub === 'continue') {
    return cmdFeatureContinue(root, home, flags);
  }
  if (sub && !sub.startsWith('--')) {
    die(`Unknown feature subcommand: ${sub}`);
  }
  return cmdFeatureStart(root, home, flags);
}

function cmdVerify(root, positional) {
  const sub = positional[0];
  if (sub === 'run') {
    cmdVerifyRun(root);
    return;
  }
  if (sub === 'report') {
    cmdVerifyReport(root);
    return;
  }
  die('Usage: eos verify <run|report>');
}

async function main() {
  const { command, positional, flags } = parseArgs(process.argv);
  const root = consumerRoot();
  const home = frameworkHome();

  try {
    switch (command) {
      case 'help':
      case '--help':
      case '-h':
        console.log(usage());
        break;
      case 'init':
        cmdInit(root, home);
        break;
      case 'detect':
        cmdDetect(root, home);
        break;
      case 'start':
        cmdStart(root, home, positional[0]);
        break;
      case 'feature':
        await cmdFeature(root, home, positional, flags);
        break;
      case 'verify':
        cmdVerify(root, positional);
        break;
      case 'status':
        cmdStatus(root, home, flags);
        break;
      case 'next':
        cmdNext(root, home);
        break;
      case 'gate':
        await cmdGate(root, home, positional[0], flags);
        break;
      case 'decision': {
        const sub = positional[0];
        if (sub === 'list') cmdDecisionList(root, flags);
        else if (sub === 'answer') await cmdDecisionAnswer(root, home, positional[1], flags);
        else die('Usage: eos decision list | eos decision answer <id> --option <optionId>');
        break;
      }
      case 'complete-phase':
        cmdCompletePhase(root, home, flags);
        break;
      case 'guard':
        cmdGuard(root, home, positional, flags);
        break;
      case 'set-flag':
        cmdSetFlag(root, positional[0], positional[1]);
        break;
      case 'mark-artifact':
        cmdMarkArtifact(root, positional[0], positional[1]);
        break;
      case 'abort-run': {
        const state = requireState(root);
        abortRun(state);
        saveState(root, state);
        console.log('Active run aborted.');
        break;
      }
      case 'cleanup':
        cmdCleanup(root, flags);
        break;
      case 'validate':
        cmdValidate(root, home, flags);
        break;
      case 'workflows':
        console.log(listWorkflows(home).join('\n'));
        break;
      case 'intel':
        await cmdIntel(root, home, positional, flags);
        break;
      case 'context':
        cmdContext(root, home, positional);
        break;
      case 'knowledge':
        cmdKnowledge(root, home, positional, flags);
        break;
      default:
        die(`Unknown command: ${command}\n\n${usage()}`);
    }
  } catch (err) {
    die(err.message || String(err));
  }
}

main().catch((err) => die(err.message || String(err)));
