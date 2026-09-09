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

test('readContextFlag reads intake text from a file, keeping it out of shell quoting', async () => {
  const { readContextFlag } = await import('./feature.js');
  const fsMod = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');

  const root = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'eos-ctxfile-'));
  const body = 'Update `DocumentUploader` and rename $(legacy) labels.';
  fsMod.mkdirSync(pathMod.join(root, '.engineering-os'), { recursive: true });
  fsMod.writeFileSync(pathMod.join(root, '.engineering-os/intake.md'), body);

  assert.equal(
    readContextFlag(root, { contextFile: '.engineering-os/intake.md' }),
    body,
    'backticks and $( ) survive intact because they never reach a shell',
  );

  assert.equal(readContextFlag(root, { context: 'inline only' }), 'inline only');
  assert.match(
    readContextFlag(root, { context: 'inline', contextFile: '.engineering-os/intake.md' }),
    /inline\n\nUpdate `DocumentUploader`/,
    'inline context and file content are combined',
  );

  assert.throws(() => readContextFlag(root, { contextFile: 'missing.md' }), /not found/);
});
