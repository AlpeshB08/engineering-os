import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('./cli.js', import.meta.url));
const frameworkRoot = path.resolve(path.dirname(cli), '..', '..');

function permittedRun(overrides = {}) {
  return {
    id: 'run-cli',
    status: 'active',
    current_phase: 'implement',
    implementation_entered_at: '2026-01-01T00:00:00.000Z',
    blocked: false,
    orchestration: { blockers: [] },
    flags: { architectural_impact: false },
    gates: {
      'plan-approval': { status: 'approved', run_id: 'run-cli' },
      'contract-approval': { status: 'approved', run_id: 'run-cli' },
    },
    workflow_decisions: {},
    ...overrides,
  };
}

function createRoot(run = null) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-cli-'));
  fs.mkdirSync(path.join(root, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.engineering-os', 'state.json'),
    JSON.stringify({ version: 1, initialized_at: 't', capabilities: {}, active_run: run })
  );
  return root;
}

function invoke(root, payload, flag = '') {
  const args = [cli, 'guard', 'hook'];
  if (flag) args.push(flag);
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ENGINEERING_OS_HOME: frameworkRoot },
    input: typeof payload === 'string' ? payload : JSON.stringify(payload),
    encoding: 'utf8',
  });
  return { ...result, response: JSON.parse(result.stdout.trim()) };
}

test('guard hook CLI denies invalid JSON with exit 2', () => {
  const result = invoke(createRoot(), '{bad-json');
  assert.equal(result.status, 2);
  assert.equal(result.response.permission, 'deny');
});

test('guard hook CLI denies malformed tool payloads and missing mutation paths', () => {
  const root = createRoot(permittedRun());
  for (const payload of [{}, { tool_name: 'Write', tool_input: {} }, { tool_name: 'EditNotebook', tool_input: {} }]) {
    const result = invoke(root, payload);
    assert.equal(result.status, 2);
    assert.equal(result.response.permission, 'deny');
  }
});

test('guard hook CLI enforces run and phase authorization', () => {
  const mutation = { tool_name: 'Write', tool_input: { path: 'src/App.tsx' } };
  assert.equal(invoke(createRoot(), mutation).status, 2);
  assert.equal(invoke(createRoot(permittedRun({ current_phase: 'plan' })), mutation).status, 2);
  assert.equal(invoke(createRoot(permittedRun()), mutation).status, 0);
});

test('guard hook CLI permits EOS artifacts during planning', () => {
  const root = createRoot(permittedRun({ current_phase: 'plan' }));
  const result = invoke(root, {
    tool_name: 'Write',
    tool_input: { path: '.engineering-os/artifacts/run-cli/plan.md' },
  });
  assert.equal(result.status, 0);
  assert.equal(result.response.permission, 'allow');
});

test('guard hook CLI denies stale gates and pending decisions', () => {
  const mutation = { tool_name: 'Write', tool_input: { path: 'src/App.tsx' } };
  const stale = permittedRun();
  stale.gates['plan-approval'].run_id = 'old-run';
  assert.equal(invoke(createRoot(stale), mutation).status, 2);

  const pending = permittedRun({
    workflow_decisions: {
      backend: {
        id: 'backend',
        status: 'pending',
        category: 'backend',
        question: 'Backend?',
        options: [{ id: 'a', label: 'A' }],
      },
    },
  });
  assert.equal(invoke(createRoot(pending), mutation).status, 2);
});

test('guard hook CLI applies shell complete-command semantics', () => {
  const root = createRoot(permittedRun({ current_phase: 'plan' }));
  assert.equal(invoke(root, { command: 'git status && npm test' }, '--shell').status, 0);
  assert.equal(invoke(root, { command: 'git status; make build' }, '--shell').status, 2);
  assert.equal(invoke(root, { command: 'echo changed > src/App.tsx' }, '--shell').status, 2);
  assert.equal(invoke(root, { command: 'echo $(touch src/x)' }, '--shell').status, 2);
});

test('guard hook CLI applies MCP precedence and target rules', () => {
  const root = createRoot(permittedRun({ current_phase: 'plan' }));
  assert.equal(invoke(root, {
    tool_name: 'get_screenshot',
    arguments: { url: 'https://example.com' },
  }, '--mcp').status, 0);
  assert.equal(invoke(root, {
    tool_name: 'search_and_save',
    arguments: { path: 'src/result.json' },
  }, '--mcp').status, 2);
  assert.equal(invoke(root, {
    tool_name: 'opaque_action',
    arguments: { path: 'src/result.json' },
  }, '--mcp').status, 2);
  assert.equal(invoke(root, {
    tool_name: 'download_file',
    arguments: { downloadPath: '.engineering-os/download.bin' },
  }, '--mcp').status, 0);
});
