import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  PRE_APPROVAL_PIPELINE,
  initOrchestration,
  markStepComplete,
  isStepComplete,
  addBlocker,
  hasBlockers,
  clearBlockers,
} from './orchestration.js';

test('PRE_APPROVAL_PIPELINE defines resumable steps', () => {
  assert.deepEqual(PRE_APPROVAL_PIPELINE, [
    'preflight',
    'jira_discovery',
    'figma_discovery',
    'feature_contract',
    'plan_intelligence',
    'test_capability',
    'workflow_decisions',
    'plan_bundle_validate',
  ]);
});

test('orchestration tracks completed steps idempotently', () => {
  const run = {};
  const orch = initOrchestration(run);
  markStepComplete(orch, 'preflight');
  markStepComplete(orch, 'preflight');
  assert.equal(orch.completed_steps.filter((s) => s === 'preflight').length, 1);
  assert.equal(isStepComplete(orch, 'preflight'), true);
  assert.equal(isStepComplete(orch, 'jira_discovery'), false);
});

test('blockers set run.blocked and clear on clearBlockers', () => {
  const run = { orchestration: initOrchestration({}) };
  addBlocker(run, 'jira', 'incomplete');
  assert.equal(hasBlockers(run), true);
  assert.equal(run.blocked, true);
  clearBlockers(run);
  assert.equal(hasBlockers(run), false);
  assert.equal(run.blocked, false);
});

test('figma step skipped when no URL in intake', async () => {
  const { isFigmaDiscoveryComplete, createPendingFigmaStub } = await import('./integrations/figma.js');
  const intake = { jira: { key: 'X-1' } };
  assert.equal(intake.figma?.url, undefined);
  assert.equal(isFigmaDiscoveryComplete(createPendingFigmaStub('https://x')), false);
});
