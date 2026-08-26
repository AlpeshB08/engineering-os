import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCapabilities } from './detect.js';
import { decideTestStrategy } from './intelligence/testStrategy.js';
import {
  detectTestCapabilities,
  isAutomationAvailable,
  recordTestCapabilityDecision,
  resolveTestStrategyWithCapabilities,
  SETUP_VERIFICATION,
} from './intelligence/testCapabilities.js';
import {
  DECISION_IDS,
  DECISION_STATUS,
  answerWorkflowDecision,
  applyWorkflowDecisionEffects,
  blockForPendingDecisions,
  getPendingDecisions,
  hasPendingWorkflowDecisions,
  isE2eManualFallbackChosen,
  registerWorkflowDecision,
  renderPendingDecisionsMessage,
  validateDecisionSpec,
} from './workflowDecisions.js';
import { discoverImplementationDecisions } from './decisionDiscovery.js';
import { hasBlockers } from './orchestration.js';

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eos-wdec-'));
}

function writePkg(dir, body) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(body, null, 2));
}

function highRiskContext(dir) {
  const caps = detectTestCapabilities(dir, detectCapabilities(dir));
  const strategy = decideTestStrategy({
    contractText: 'auth login permission delete user workflow onboarding journey',
    impactText: '## Routes / screens\n- `src/pages/Login.tsx`\n- `src/pages/Dashboard.tsx`\n',
    capabilities: detectCapabilities(dir),
    intake: {},
  });
  const run = {};
  const resolved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run,
    root: dir,
  });
  return { caps, strategy, resolved, run };
}

test('unresolved decision keeps workflow pending and blocked', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { test: 'vitest run' }, devDependencies: { vitest: '2.0.0' } });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const { resolved, run } = highRiskContext(dir);
  discoverImplementationDecisions(run, { resolved, backend: { needsBackend: false, availability: 'yes' } });
  assert.ok(hasPendingWorkflowDecisions(run));
  assert.equal(getPendingDecisions(run)[0].id, DECISION_IDS.E2E_AUTOMATION);
  assert.match(renderPendingDecisionsMessage(run), /No response is NOT a decision/);
});

test('no automatic approval or rejection without explicit input', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { build: 'vite build' }, devDependencies: { vite: '6.0.0' } });
  const { resolved, run } = highRiskContext(dir);
  discoverImplementationDecisions(run, { resolved, backend: { needsBackend: false, availability: 'yes' } });
  assert.equal(run.gates?.['test-capability-setup']?.status, undefined);
  assert.equal(run.test_capability_decisions?.e2e, undefined);
  assert.equal(run.workflow_decisions?.[DECISION_IDS.E2E_AUTOMATION]?.status, DECISION_STATUS.PENDING);
});

test('timeout or missing input remains pending', () => {
  const run = {
    workflow_decisions: {
      [DECISION_IDS.E2E_AUTOMATION]: {
        id: DECISION_IDS.E2E_AUTOMATION,
        status: DECISION_STATUS.PENDING,
        question: 'pending',
        options: [{ id: 'manual_qa', label: 'Manual QA' }],
      },
    },
  };
  assert.ok(hasPendingWorkflowDecisions(run));
  assert.equal(isE2eManualFallbackChosen(run), false);
});

test('E2E required + unavailable creates user decision', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { test: 'vitest run' }, devDependencies: { vitest: '2.0.0' } });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const { resolved, run } = highRiskContext(dir);
  discoverImplementationDecisions(run, { resolved, backend: {} });
  const decision = run.workflow_decisions[DECISION_IDS.E2E_AUTOMATION];
  assert.equal(decision.status, DECISION_STATUS.PENDING);
  assert.ok(decision.options.some((o) => o.id === 'proceed_without_e2e'));
  assert.ok(decision.options.some((o) => o.id === 'wait_for_e2e'));
  assert.equal(decision.options.some((o) => o.id === 'setup_e2e'), false);
});

test('explicit Manual QA choice records rejection strategy', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { test: 'vitest run' }, devDependencies: { vitest: '2.0.0' } });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const { resolved, run } = highRiskContext(dir);
  run.test_capability_proposals = resolved.proposals;
  discoverImplementationDecisions(run, { resolved, backend: {} });
  answerWorkflowDecision(run, DECISION_IDS.E2E_AUTOMATION, 'proceed_without_e2e', { source: 'user' });
  recordTestCapabilityDecision(run, 'e2e', 'declined');
  const reResolved = resolveTestStrategyWithCapabilities({
    strategy: resolved.strategy,
    testCapabilities: resolved.testCapabilities,
    run,
    root: dir,
  });
  assert.equal(reResolved.strategy.e2e.required, false);
  assert.equal(reResolved.strategy.manual.required, true);
  assert.ok(isE2eManualFallbackChosen(run));
});

test('E2E setup failure creates new pending decision without auto fallback', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { 'test:e2e': 'missing' }, devDependencies: { '@playwright/test': '1.0.0' } });
  const run = {
    test_capability_decisions: { e2e: 'setup_failed' },
    test_capability_verification: {
      e2e: { status: SETUP_VERIFICATION.FAILED, summary: 'browser missing' },
    },
  };
  const caps = detectTestCapabilities(dir);
  const resolved = resolveTestStrategyWithCapabilities({
    strategy: {
      unit: { required: false, reason: '' },
      e2e: { required: true, reason: '' },
      manual: { required: true, reason: '' },
      risk: { unit: false, e2e: true },
      signals: {},
      repository: {},
    },
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(resolved.strategy.e2e.pendingApproval, true);
  assert.equal(isE2eManualFallbackChosen(run), false);
  discoverImplementationDecisions(run, { resolved, backend: {} });
  assert.equal(run.workflow_decisions[DECISION_IDS.E2E_SETUP_FAILURE].status, DECISION_STATUS.PENDING);
});

test('explicit Manual QA after setup failure enables fallback', () => {
  const run = { test_capability_decisions: { e2e: 'setup_failed' }, workflow_decisions: {} };
  discoverImplementationDecisions(run, {
    resolved: { strategy: { risk: { e2e: true } }, testCapabilities: { e2e: { status: 'unavailable' } } },
    backend: {},
  });
  answerWorkflowDecision(run, DECISION_IDS.E2E_SETUP_FAILURE, 'manual_qa', { source: 'user' });
  recordTestCapabilityDecision(run, 'e2e', 'declined');
  assert.ok(isE2eManualFallbackChosen(run));
});

test('answered decisions are not re-created as pending', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { test: 'vitest run' }, devDependencies: { vitest: '2.0.0' } });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const { resolved, run } = highRiskContext(dir);
  discoverImplementationDecisions(run, { resolved, backend: {} });
  answerWorkflowDecision(run, DECISION_IDS.E2E_AUTOMATION, 'proceed_without_e2e', { source: 'user' });
  run.gates = { 'test-capability-setup': { status: 'rejected' } };
  recordTestCapabilityDecision(run, 'e2e', 'declined');
  discoverImplementationDecisions(run, { resolved, backend: {} });
  assert.equal(getPendingDecisions(run).length, 0);
  assert.throws(() => answerWorkflowDecision(run, DECISION_IDS.E2E_AUTOMATION, 'setup_e2e', { source: 'user' }));
});

test('backend dependency decision is created when backend availability unknown', () => {
  const run = {};
  discoverImplementationDecisions(run, {
    resolved: { strategy: { risk: {} }, testCapabilities: {} },
    backend: { needsBackend: true, availability: 'unknown' },
  });
  assert.equal(run.workflow_decisions[DECISION_IDS.BACKEND_DEPENDENCY].status, DECISION_STATUS.PENDING);
});

test('blockForPendingDecisions sets orchestration blocker', () => {
  const run = {};
  run.workflow_decisions = {
    [DECISION_IDS.E2E_AUTOMATION]: {
      id: DECISION_IDS.E2E_AUTOMATION,
      status: DECISION_STATUS.PENDING,
      question: 'Choose',
      options: [{ id: 'manual_qa', label: 'Manual QA' }],
    },
  };
  assert.equal(blockForPendingDecisions(run), true);
  assert.ok(hasBlockers(run));
});

test('validateDecisionSpec requires id, category, question, impact, and two options', () => {
  const invalid = validateDecisionSpec({ id: 'x', category: 'test', question: 'Q?' });
  assert.equal(invalid.ok, false);
  assert.ok(invalid.errors.some((e) => e.includes('impact')));
  assert.ok(invalid.errors.some((e) => e.includes('options')));

  const valid = validateDecisionSpec({
    id: 'custom-decision',
    category: 'custom',
    question: 'Choose a path?',
    impact: 'Affects implementation scope.',
    options: [
      { id: 'a', label: 'Option A' },
      { id: 'b', label: 'Option B' },
    ],
  });
  assert.equal(valid.ok, true);
});

test('registerWorkflowDecision stores generic decision with resultingStrategy on options', () => {
  const run = {};
  registerWorkflowDecision(run, {
    id: 'api-version',
    category: 'architecture',
    question: 'Which API version should be used?',
    impact: 'Determines contract and verification targets.',
    options: [
      { id: 'v1', label: 'Use v1 API', resultingStrategy: 'Implement against v1 API.' },
      { id: 'v2', label: 'Use v2 API', resultingStrategy: 'Implement against v2 API.' },
    ],
  });
  const decision = run.workflow_decisions['api-version'];
  assert.equal(decision.status, DECISION_STATUS.PENDING);
  assert.equal(decision.impact, 'Determines contract and verification targets.');
  assert.equal(decision.options[0].resultingStrategy, 'Implement against v1 API.');
});

test('multiple pending decisions block until all are answered', () => {
  const run = {};
  registerWorkflowDecision(run, {
    id: 'decision-a',
    category: 'requirements',
    question: 'Question A?',
    impact: 'Impact A.',
    options: [
      { id: 'a1', label: 'A1' },
      { id: 'a2', label: 'A2' },
    ],
  });
  registerWorkflowDecision(run, {
    id: 'decision-b',
    category: 'backend',
    question: 'Question B?',
    impact: 'Impact B.',
    options: [
      { id: 'b1', label: 'B1' },
      { id: 'b2', label: 'B2' },
    ],
  });
  assert.equal(getPendingDecisions(run).length, 2);
  assert.ok(hasPendingWorkflowDecisions(run));
  answerWorkflowDecision(run, 'decision-a', 'a1', { source: 'user' });
  assert.ok(hasPendingWorkflowDecisions(run));
  answerWorkflowDecision(run, 'decision-b', 'b1', { source: 'user' });
  assert.equal(hasPendingWorkflowDecisions(run), false);
});

test('invalid answer throws and leaves decision pending', () => {
  const run = {};
  registerWorkflowDecision(run, {
    id: 'invalid-test',
    category: 'test',
    question: 'Pick one?',
    impact: 'Test impact.',
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'no', label: 'No' },
    ],
  });
  assert.throws(() => answerWorkflowDecision(run, 'invalid-test', 'maybe', { source: 'user' }));
  assert.equal(run.workflow_decisions['invalid-test'].status, DECISION_STATUS.PENDING);
});

test('explicit answer persists resulting strategy for subsequent steps', () => {
  const run = { artifacts_dir: '/tmp/none' };
  registerWorkflowDecision(run, {
    id: DECISION_IDS.BACKEND_DEPENDENCY,
    category: 'backend',
    question: 'Backend?',
    impact: 'Implementation path.',
    options: [
      { id: 'fe_only_stub', label: 'FE only', resultingStrategy: 'FE-only with stubs.' },
      { id: 'wait_for_backend', label: 'Wait', resultingStrategy: 'Wait for backend.' },
    ],
  });
  answerWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY, 'fe_only_stub', { source: 'user' });
  applyWorkflowDecisionEffects(run, DECISION_IDS.BACKEND_DEPENDENCY, 'fe_only_stub');
  assert.equal(run.flags.backend_dependency_strategy, 'fe_only_stub');
  assert.equal(
    run.workflow_decisions[DECISION_IDS.BACKEND_DEPENDENCY].resultingStrategy,
    'FE-only with stubs.'
  );
});
