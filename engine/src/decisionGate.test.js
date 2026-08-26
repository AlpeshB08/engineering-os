import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlanBundle, artifactPath } from './artifacts.js';
import { templatesDir } from './paths.js';
import { replaceTokens, today } from './util.js';
import { canEnterImplement, completePhase, loadWorkflow } from './workflow.js';
import { frameworkHome } from './paths.js';
import { hasBlockers, initOrchestration, markStepComplete } from './orchestration.js';
import { isImplementationPermitted } from './guard.js';
import {
  DECISION_IDS,
  DECISION_STATUS,
  answerWorkflowDecision,
  canPassDecisionGate,
  enforceDecisionGate,
  hasPendingWorkflowDecisions,
  registerWorkflowDecision,
} from './workflowDecisions.js';

function seedMinimalBundle(root) {
  const eosRoot = path.join(root, '.engineering-os');
  const runId = 'decision-gate-test';
  const artifactsDir = path.join(eosRoot, 'artifacts', runId);
  fs.mkdirSync(path.join(eosRoot, 'integrations'), { recursive: true });
  fs.mkdirSync(artifactsDir, { recursive: true });
  const home = path.resolve(import.meta.dirname, '..', '..');
  const tokens = { run_id: runId, workflow_id: 'feature-development', date: today() };

  for (const file of [
    'discovery-notes.md',
    'feature-contract.md',
    'feature-impact.md',
    'reuse-analysis.md',
    'backend-dependency.md',
    'verification-plan.md',
    'implementation-plan.md',
  ]) {
    const template = fs.readFileSync(path.join(templatesDir(home), file), 'utf8');
    fs.writeFileSync(path.join(artifactsDir, file), replaceTokens(template, tokens));
  }

  let contract = fs.readFileSync(artifactPath(artifactsDir, 'feature-contract'), 'utf8');
  contract = contract.replace(
    /## Problem[\s\S]*?(?=\n## )/,
    '## Problem\n\nExport items to CSV\n\n'
  );
  contract = contract.replace(
    /## Acceptance Criteria[\s\S]*?(?=\n## )/,
    '## Acceptance Criteria\n\n1. Export button visible\n2. CSV download works\n\n'
  );
  fs.writeFileSync(artifactPath(artifactsDir, 'feature-contract'), contract);

  let discovery = fs.readFileSync(artifactPath(artifactsDir, 'discovery-notes'), 'utf8');
  discovery += `\n## Jira requirements (TEST-1)\n\nSummary and AC content here with enough length to pass validation.\n\nAcceptance criteria listed.\n`;
  fs.writeFileSync(artifactPath(artifactsDir, 'discovery-notes'), discovery);

  fs.writeFileSync(
    path.join(eosRoot, 'integrations', 'jira-TEST-1.json'),
    JSON.stringify({
      key: 'TEST-1',
      summary: 'Export',
      acceptance_criteria: ['Export button visible', 'CSV download works'],
      discovery: { complete: true, source: 'agent' },
    })
  );

  let plan = fs.readFileSync(artifactPath(artifactsDir, 'verification-plan'), 'utf8');
  plan = plan.replace(
    '### Manual test scenarios\n\n- _(not required)_',
    '### Manual test scenarios\n\n- AC1-M01: Manual verification — Export button visible\n- AC2-M01: Manual verification — CSV download works'
  );
  plan = plan.replace(
    '| AC1 | | | | | | | | |',
    '| AC1: Export button visible | x | | | | | | | |\n| AC2: CSV download works | x | | | | | | | |'
  );
  fs.writeFileSync(artifactPath(artifactsDir, 'verification-plan'), plan);

  let impl = fs.readFileSync(artifactPath(artifactsDir, 'implementation-plan'), 'utf8');
  impl = impl.replace(
    /## Implementation steps[\s\S]*?(?=\n## )/,
    '## Implementation steps\n\n1. Add export button\n2. Wire CSV download\n\n'
  );
  fs.writeFileSync(artifactPath(artifactsDir, 'implementation-plan'), impl);

  for (const id of ['feature-impact', 'reuse-analysis', 'backend-dependency']) {
    const p = artifactPath(artifactsDir, id);
    let c = fs.readFileSync(p, 'utf8');
    c = c.replace('draft', 'ready');
    fs.writeFileSync(p, c);
  }

  return {
    run: {
      id: runId,
      artifacts_dir: artifactsDir,
      blocked: false,
      gates: {
        'plan-approval': { status: 'approved', run_id: runId },
        'contract-approval': { status: 'approved', run_id: runId },
      },
      orchestration: { blockers: [], completed_steps: ['workflow_decisions'] },
    },
    state: { feature_intake: { jira: { key: 'TEST-1' } } },
    eosRoot,
  };
}

function runWithPendingDecision(overrides = {}) {
  const { run, state, eosRoot } = seedMinimalBundle(fs.mkdtempSync(path.join(os.tmpdir(), 'eos-dgate-')));
  registerWorkflowDecision(run, {
    id: DECISION_IDS.BACKEND_DEPENDENCY,
    category: 'backend',
    question: 'Backend unavailable — how to proceed?',
    impact: 'Determines implementation path.',
    options: [
      { id: 'fe_only_stub', label: 'FE only' },
      { id: 'wait_for_backend', label: 'Wait' },
    ],
  });
  Object.assign(run, overrides);
  return { run, state, eosRoot };
}

test('canPassDecisionGate blocks when required decision is pending', () => {
  const { run } = runWithPendingDecision();
  const gate = canPassDecisionGate(run);
  assert.equal(gate.ok, false);
  assert.equal(gate.pending.length, 1);
});

test('enforceDecisionGate syncs orchestration blockers with pending decisions', () => {
  const { run } = runWithPendingDecision({ blocked: false, orchestration: { blockers: [], completed_steps: [] } });
  initOrchestration(run);
  assert.equal(enforceDecisionGate(run).ok, false);
  assert.ok(hasBlockers(run));
  assert.ok(run.orchestration.blockers.some((b) => b.type === 'workflow_decision'));
});

test('pending decision prevents plan-approval bundle validation', () => {
  const { run, state, eosRoot } = runWithPendingDecision();
  const result = validatePlanBundle(run, state, eosRoot);
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('pending_workflow_decisions'));
});

test('pending decision prevents implementation even with plan approval', () => {
  const { run } = runWithPendingDecision();
  assert.equal(canEnterImplement(run).ok, false);
  assert.equal(isImplementationPermitted(run).ok, false);
});

test('pending decision prevents implementation transition via completePhase', () => {
  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const approveIndex = workflow.phases.findIndex((p) => p.id === 'approve');
  const { run } = runWithPendingDecision();

  const state = {
    active_run: {
      ...run,
      status: 'active',
      workflow_id: 'feature-development',
      phase_index: approveIndex,
      current_phase: 'approve',
      completed_phases: [],
      flags: { architectural_impact: false },
    },
  };

  const result = completePhase({
    frameworkRoot: home,
    eosRoot: '/tmp/.engineering-os',
    state,
    force: false,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /workflow decisions/i);
});

test('pending decision blocks implement even with --force on completePhase', () => {
  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const approveIndex = workflow.phases.findIndex((p) => p.id === 'approve');
  const { run } = runWithPendingDecision();

  const state = {
    active_run: {
      ...run,
      status: 'active',
      workflow_id: 'feature-development',
      phase_index: approveIndex,
      current_phase: 'approve',
      completed_phases: [],
      flags: { architectural_impact: false },
    },
  };

  const result = completePhase({
    frameworkRoot: home,
    eosRoot: '/tmp/.engineering-os',
    state,
    force: true,
  });
  assert.equal(result.ok, false);
});

test('explicit answer clears pending state but requires implement phase', () => {
  const { run } = runWithPendingDecision({ status: 'active', current_phase: 'approve' });
  answerWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY, 'fe_only_stub', { source: 'user' });
  assert.equal(hasPendingWorkflowDecisions(run), false);
  assert.equal(isImplementationPermitted(run).ok, false);
  run.current_phase = 'implement';
  run.implementation_entered_at = new Date().toISOString();
  run.gates['contract-approval'] = { status: 'approved', run_id: run.id };
  assert.equal(isImplementationPermitted(run).ok, true);
});

test('multiple pending decisions all block until every one is answered', () => {
  const { run } = runWithPendingDecision();
  registerWorkflowDecision(run, {
    id: DECISION_IDS.REQUIREMENT_CLARITY,
    category: 'requirements',
    question: 'Ambiguous AC?',
    impact: 'Scope.',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  });
  assert.equal(canPassDecisionGate(run).pending.length, 2);
  answerWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY, 'fe_only_stub', { source: 'user' });
  assert.ok(hasPendingWorkflowDecisions(run));
  answerWorkflowDecision(run, DECISION_IDS.REQUIREMENT_CLARITY, 'a', { source: 'user' });
  assert.equal(hasPendingWorkflowDecisions(run), false);
});

test('non-required pending decision does not block gate', () => {
  const run = { workflow_decisions: {} };
  registerWorkflowDecision(run, {
    id: 'optional-note',
    category: 'info',
    question: 'Optional?',
    impact: 'No impact.',
    required: false,
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
  });
  assert.equal(canPassDecisionGate(run).ok, true);
});

test('completed workflow_decisions step does not bypass gate when pending decisions remain', () => {
  const { run } = runWithPendingDecision();
  initOrchestration(run);
  markStepComplete(run.orchestration, 'workflow_decisions');
  run.blocked = false;
  run.orchestration.blockers = [];
  enforceDecisionGate(run);
  assert.ok(hasBlockers(run));
  assert.ok(hasPendingWorkflowDecisions(run));
});

test('cancellation and timeout remain pending — no implicit resolution', () => {
  const run = {
    workflow_decisions: {
      [DECISION_IDS.E2E_AUTOMATION]: {
        id: DECISION_IDS.E2E_AUTOMATION,
        status: DECISION_STATUS.PENDING,
        required: true,
        question: 'E2E?',
        options: [{ id: 'setup_e2e', label: 'Setup' }, { id: 'manual_qa', label: 'Manual QA' }],
      },
    },
  };
  assert.equal(isImplementationPermitted({ ...run, gates: { 'plan-approval': { status: 'approved', run_id: 'x' } }, id: 'x', blocked: false, orchestration: { blockers: [] } }).ok, false);
});
