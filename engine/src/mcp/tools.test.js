import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { captureOutput, featureStart, featureContinue, featureStatus, guardCheck } from './tools.js';
import { frameworkHome } from '../paths.js';

const HOME = frameworkHome();
const CLI = path.join(HOME, 'engine/src/cli.js');

function mkConsumer() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mcp-'));
  fs.mkdirSync(path.join(dir, 'src', 'pages'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'mcp-app',
      devDependencies: { vitest: '2.0.0' },
      scripts: { lint: 'node -e "process.exit(0)"', test: 'node -e "process.exit(0)"' },
    })
  );
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  fs.writeFileSync(path.join(dir, 'src', 'pages', 'Home.tsx'), 'export default function H(){return null;}');
  execFileSync('node', [CLI, 'init'], {
    cwd: dir,
    env: { ...process.env, ENGINEERING_OS_HOME: HOME },
    stdio: 'ignore',
  });
  return dir;
}

test('captureOutput keeps engine console output off stdout and restores exitCode', async () => {
  const before = process.exitCode;
  const captured = await captureOutput(async () => {
    console.log('this must not reach stdout');
    console.error('nor this');
    process.exitCode = 1;
    return 'value';
  });
  assert.equal(captured.ok, true);
  assert.equal(captured.result, 'value');
  assert.match(captured.output, /must not reach stdout/);
  // console is restored and the exit code is not leaked to the server process
  assert.equal(process.exitCode, before);
  assert.equal(typeof console.log, 'function');
});

test('captureOutput contains a throwing handler instead of propagating', async () => {
  const captured = await captureOutput(async () => {
    throw new Error('boom');
  });
  assert.equal(captured.ok, false);
  assert.match(captured.error, /boom/);
  assert.equal(typeof console.log, 'function');
});

test('featureStatus reports uninitialized repositories without throwing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mcp-bare-'));
  const status = await featureStatus({}, { root: dir, home: HOME });
  assert.equal(status.ok, true);
  assert.equal(status.initialized, false);
});

test('feature_start returns a structured turn and feature_status reads it back', async () => {
  const root = mkConsumer();
  const started = await featureStart(
    { context: 'Add a dark mode toggle that persists the preference to localStorage' },
    { root, home: HOME }
  );
  assert.equal(started.ok, true, started.error);
  assert.ok(started.turn, 'a turn payload is returned');
  assert.ok(started.stage, 'a stage is reported');

  const status = await featureStatus({}, { root, home: HOME });
  assert.equal(status.ok, true);
  assert.equal(status.initialized, true);
  assert.equal(status.turn.run_id, started.turn.run_id, 'status reads the same run');
});

test('guard_check refuses application mutation before implementation is authorized', async () => {
  const root = mkConsumer();
  await featureStart({ context: 'Add a dark mode toggle that persists to localStorage' }, { root, home: HOME });
  const check = await guardCheck({ path: 'src/pages/Settings.tsx' }, { root, home: HOME });
  assert.equal(check.ok, true, 'the tool call itself succeeds');
  assert.equal(check.permitted, false, 'but mutation is not permitted yet');
  assert.match(check.reason || '', /not permitted|blocked|decision/i);
});

test('feature_continue surfaces a refusal as a structured error rather than throwing', async () => {
  const root = mkConsumer();
  await featureStart({ context: 'Add a dark mode toggle that persists to localStorage' }, { root, home: HOME });
  // Confirming test cases before the strategy is confirmed must be refused, not crash.
  const result = await featureContinue({ confirm: 'test-cases' }, { root, home: HOME });
  assert.equal(result.ok, false);
  assert.ok(result.error, 'a reason is reported to the caller');
});

test('feature_continue answers a decision and advances the same run', async () => {
  const root = mkConsumer();
  const started = await featureStart(
    { context: 'Add a dark mode toggle that persists the preference to localStorage' },
    { root, home: HOME }
  );
  const pending = started.turn.pending_decision_ids || [];
  if (!pending.length) return; // nothing to answer in this environment
  const target = pending.includes('e2e-automation') ? 'e2e-automation' : pending[0];
  const option = target === 'e2e-automation' ? 'proceed_without_e2e' : undefined;
  const result = await featureContinue(
    option ? { decision: target, option } : { decision: target, answer: 'Persisted to localStorage.' },
    { root, home: HOME }
  );
  assert.equal(result.ok, true, result.error);
  assert.equal(result.turn.run_id, started.turn.run_id, 'same run continues');
});
