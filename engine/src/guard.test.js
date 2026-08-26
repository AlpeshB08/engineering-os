import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  authorizeApplicationMutation,
  buildGuardManifest,
  buildHookDenyResponse,
  canEnterImplementPhase,
  classifyMcpOperation,
  classifyShellCommand,
  evaluateGuardHookRequest,
  extractMutationPathsFromShellCommand,
  extractMutationPathsFromMcpInput,
  extractMutationPathsFromToolInput,
  isEngineeringOsPath,
  isImplementationPermitted,
  MUTATION_REQUEST_CLASS,
} from './guard.js';
import { advanceRunToPhase, loadWorkflow } from './workflow.js';
import { frameworkHome } from './paths.js';
import { registerWorkflowDecision, answerWorkflowDecision, DECISION_IDS } from './workflowDecisions.js';

function permittedRun(overrides = {}) {
  return {
    id: 'run-1',
    status: 'active',
    current_phase: 'implement',
    implementation_entered_at: '2026-01-01T00:00:00.000Z',
    blocked: false,
    orchestration: { blockers: [] },
    flags: { architectural_impact: false },
    gates: {
      'plan-approval': { status: 'approved', run_id: 'run-1' },
      'contract-approval': { status: 'approved', run_id: 'run-1' },
    },
    workflow_decisions: {},
    ...overrides,
  };
}

test('isImplementationPermitted requires implement phase', () => {
  const run = permittedRun({ current_phase: 'approve' });
  const check = isImplementationPermitted(run);
  assert.equal(check.ok, false);
  assert.match(check.reason, /approve/);
});

test('isImplementationPermitted requires contract-approval', () => {
  const run = permittedRun();
  delete run.gates['contract-approval'];
  assert.equal(isImplementationPermitted(run).ok, false);
});

test('isImplementationPermitted true only in implement with all gates', () => {
  assert.equal(isImplementationPermitted(permittedRun()).ok, true);
});

test('pending decisions block implementation permission in implement phase', () => {
  const run = permittedRun();
  registerWorkflowDecision(run, {
    id: DECISION_IDS.BACKEND_DEPENDENCY,
    category: 'backend',
    question: 'Backend?',
    impact: 'Path.',
    options: [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ],
  });
  assert.equal(isImplementationPermitted(run).ok, false);
});

test('isEngineeringOsPath allows artifact writes during planning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const eos = path.join(root, '.engineering-os', 'artifacts', 'run-1', 'feature-contract.md');
  fs.mkdirSync(path.dirname(eos), { recursive: true });
  assert.equal(isEngineeringOsPath('.engineering-os/artifacts/run-1/feature-contract.md', root), true);
});

test('authorizeApplicationMutation blocks application paths before implementation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const check = authorizeApplicationMutation({ root, filePath: 'src/App.tsx', run, eosInitialized: true });
  assert.equal(check.ok, false);
});

test('authorizeApplicationMutation allows application paths during implement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const check = authorizeApplicationMutation({ root, filePath: 'src/App.tsx', run, eosInitialized: true });
  assert.equal(check.ok, true);
});

test('authorizeApplicationMutation inactive when EOS not initialized', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const check = authorizeApplicationMutation({ root, filePath: 'src/App.tsx', run: null, eosInitialized: false });
  assert.equal(check.ok, true);
  assert.equal(check.scope, 'inactive');
});

test('authorizeApplicationMutation denies application paths when EOS initialized without active run', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const check = authorizeApplicationMutation({ root, filePath: 'src/App.tsx', run: null, eosInitialized: true });
  assert.equal(check.ok, false);
  assert.match(check.reason, /No active governed workflow run/i);
});

test('buildGuardManifest exposes machine-readable planning boundary', () => {
  const run = permittedRun({ current_phase: 'approve' });
  registerWorkflowDecision(run, {
    id: 'e2e-automation',
    category: 'test_capability',
    question: 'E2E?',
    impact: 'Verification.',
    options: [
      { id: 'setup_e2e', label: 'Setup' },
      { id: 'manual_qa', label: 'Manual QA' },
    ],
  });
  const manifest = buildGuardManifest(run);
  assert.equal(manifest.implementation_permitted, false);
  assert.equal(manifest.application_mutation_permitted, false);
  assert.match(manifest.allowed_write_scope[0], /engine-managed control-plane/i);
  assert.ok(manifest.protected_write_paths.includes('.engineering-os/state.json'));
  assert.equal(manifest.pending_decisions.length, 1);
});

test('extractMutationPathsFromToolInput reads Write and StrReplace paths', () => {
  assert.deepEqual(extractMutationPathsFromToolInput('Write', { path: 'src/a.ts' }), ['src/a.ts']);
  assert.deepEqual(extractMutationPathsFromToolInput('StrReplace', { path: 'src/b.ts' }), ['src/b.ts']);
  assert.deepEqual(extractMutationPathsFromToolInput('Read', { path: 'src/b.ts' }), []);
});

test('extractMutationPathsFromShellCommand detects redirects and destructive commands', () => {
  assert.deepEqual(extractMutationPathsFromShellCommand('echo hi > src/out.txt'), ['src/out.txt']);
  assert.deepEqual(extractMutationPathsFromShellCommand('cat <<EOF > src/x.ts'), ['src/x.ts']);
  assert.deepEqual(extractMutationPathsFromShellCommand('eos status'), []);
  assert.deepEqual(extractMutationPathsFromShellCommand('git status'), []);
});

test('evaluateGuardHookRequest fail-closed when mutation tool omits path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'Write', tool_input: {} },
    root,
    run,
    eosInitialized: true,
    hookKind: 'tool',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /fail-closed/i);
});

test('evaluateGuardHookRequest denies shell redirect before implement phase', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { command: 'echo code > src/App.tsx' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, false);
});

test('evaluateGuardHookRequest allows read-only shell during planning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { command: 'npm test' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, true);
});

test('classifyMcpOperation marks write-like MCP without path as unresolved', () => {
  const classified = classifyMcpOperation('upload_file', { content: 'x' });
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.UNRESOLVED);
  assert.ok(extractMutationPathsFromMcpInput('upload_file', { content: 'x' }).includes('__MCP_WRITE_UNRESOLVED__'));
});

test('evaluateGuardHookRequest fail-closed for write-like MCP without resolvable path in planning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'upload_file', arguments: { content: 'x' } },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, false);
  assert.equal(result.failClosed, true);
});

test('evaluateGuardHookRequest fail-closed for write-like MCP without resolvable path in implement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'upload_file', arguments: { content: 'x' } },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, false);
  assert.equal(result.failClosed, true);
});

test('evaluateGuardHookRequest denies MCP with null target path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'write_file', arguments: { path: null } },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /null|invalid/i);
});

test('evaluateGuardHookRequest denies MCP with empty target path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'write_file', arguments: { path: '   ' } },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, false);
});

test('evaluateGuardHookRequest denies MCP with ambiguous multiple targets', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: {
      tool_name: 'write_files',
      arguments: { paths: ['src/a.ts', 'src/b.ts'] },
    },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /ambiguous/i);
});

test('evaluateGuardHookRequest allows explicitly classified read-only MCP during planning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'get_screenshot', arguments: { url: 'https://example.com' } },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, true);
});

test('evaluateGuardHookRequest allows governed MCP with resolved path during implement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'upload_file', arguments: { path: 'src/App.tsx', content: 'x' } },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, true);
});

test('evaluateGuardHookRequest denies opaque unclassified MCP operation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'opaque_custom_action', arguments: { payload: { nested: true } } },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /unknown mutation semantics/i);
});

test('buildHookDenyResponse never returns permission allow', () => {
  const response = buildHookDenyResponse('blocked');
  assert.equal(response.permission, 'deny');
});

test('evaluateGuardHookRequest denies unknown shell during guarded workflow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { command: 'make build' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /fail-closed/i);
});

test('evaluateGuardHookRequest allows eos commands during guarded workflow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { command: 'eos intel jira --from-json ./jira.json' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, true);
});

test('evaluateGuardHookRequest denies shell interpreter even during implement phase', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { command: "node -e \"require('fs').writeFileSync('x','y')\"" },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /interpreter/i);
});

test('extractMutationPathsFromShellCommand marks interpreter as unresolved sentinel', () => {
  assert.ok(
    extractMutationPathsFromShellCommand("node -e \"require('fs').writeFileSync('x','y')\"").includes(
      '__SHELL_INTERPRETER_UNRESOLVED__'
    )
  );
});

test('answering decisions alone does not permit implementation without implement phase', () => {
  const run = permittedRun({ current_phase: 'approve' });
  registerWorkflowDecision(run, {
    id: DECISION_IDS.BACKEND_DEPENDENCY,
    category: 'backend',
    question: 'Backend?',
    impact: 'Path.',
    options: [
      { id: 'fe_only_stub', label: 'FE only' },
      { id: 'wait_for_backend', label: 'Wait' },
    ],
  });
  answerWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY, 'fe_only_stub', { source: 'user' });
  assert.equal(isImplementationPermitted(run).ok, false);
});

// --- MCP classification: write-like precedence over read-only naming ---

test('classifyMcpOperation treats search_and_save as write-like not read-only', () => {
  const classified = classifyMcpOperation('search_and_save', { path: 'src/out.txt' });
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.GOVERNED);
  assert.deepEqual(classified.paths, ['src/out.txt']);
});

test('classifyMcpOperation treats get_or_create as write-like not read-only', () => {
  const classified = classifyMcpOperation('get_or_create', { path: 'src/db.json' });
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.GOVERNED);
});

test('classifyMcpOperation treats fetch_and_update as write-like not read-only', () => {
  const classified = classifyMcpOperation('fetch_and_update', { path: 'src/config.ts' });
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.GOVERNED);
});

test('classifyMcpOperation denies unknown MCP tool even with target path', () => {
  const classified = classifyMcpOperation('opaque_custom_action', { path: 'src/App.tsx' });
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.UNRESOLVED);
});

test('classifyMcpOperation denies unknown MCP tool without path', () => {
  const classified = classifyMcpOperation('opaque_custom_action', {});
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.UNRESOLVED);
});

test('classifyMcpOperation allows explicitly read-only MCP tool', () => {
  const classified = classifyMcpOperation('get_screenshot', { url: 'https://example.com' });
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.READ_ONLY);
});

test('evaluateGuardHookRequest denies search_and_save without path during implement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'search_and_save', arguments: { query: 'x' } },
    root,
    run,
    eosInitialized: true,
    hookKind: 'mcp',
  });
  assert.equal(result.ok, false);
});

// --- Shell enforcement during implement phase ---

test('evaluateGuardHookRequest denies unknown shell command during implement phase', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { command: 'make build' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /Unclassified shell command/i);
});

test('evaluateGuardHookRequest denies custom unknown shell during implement phase', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { command: 'my-custom-deploy-script.sh --force' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, false);
});

test('evaluateGuardHookRequest allows governed shell mutation during implement phase', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { command: 'echo updated > src/App.tsx' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, true);
});

test('evaluateGuardHookRequest allows git diff during implement phase', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun();
  const result = evaluateGuardHookRequest({
    payload: { command: 'git diff src/App.tsx' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, true);
});

// --- Engineering OS path boundary / symlink escape ---

test('isEngineeringOsPath allows legitimate artifact path', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const artifact = path.join(root, '.engineering-os', 'artifacts', 'run-1', 'feature-contract.md');
  fs.mkdirSync(path.dirname(artifact), { recursive: true });
  assert.equal(isEngineeringOsPath('.engineering-os/artifacts/run-1/feature-contract.md', root), true);
});

test('authorizeApplicationMutation allows legitimate EOS artifact during planning', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const artifactDir = path.join(root, '.engineering-os', 'artifacts', 'run-1');
  fs.mkdirSync(artifactDir, { recursive: true });
  const run = permittedRun({ current_phase: 'approve' });
  const check = authorizeApplicationMutation({
    root,
    filePath: '.engineering-os/artifacts/run-1/feature-contract.md',
    run,
    eosInitialized: true,
  });
  assert.equal(check.ok, true);
  assert.equal(check.scope, 'engineering-os');
});

test('authorizeApplicationMutation denies direct state control-plane mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  fs.mkdirSync(path.join(root, '.engineering-os'), { recursive: true });
  const check = authorizeApplicationMutation({
    root,
    filePath: '.engineering-os/state.json',
    run: permittedRun({ current_phase: 'plan' }),
    eosInitialized: true,
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /control-plane|engine-managed/i);
});

test('authorizeApplicationMutation denies direct staged setup manifest mutation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const staging = path.join(root, '.engineering-os', 'test-setup-staging', 'run-1');
  fs.mkdirSync(staging, { recursive: true });
  const check = authorizeApplicationMutation({
    root,
    filePath: '.engineering-os/test-setup-staging/run-1/manifest.json',
    run: permittedRun(),
    eosInitialized: true,
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /control-plane|engine-managed/i);
});

test('isEngineeringOsPath denies symlink inside EOS pointing outside', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  fs.mkdirSync(path.join(root, '.engineering-os'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.symlinkSync(path.join(root, 'src'), path.join(root, '.engineering-os', 'escape'), 'dir');
  assert.equal(isEngineeringOsPath('.engineering-os/escape/App.tsx', root), false);
});

test('authorizeApplicationMutation denies symlink escape path during implement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  fs.mkdirSync(path.join(root, '.engineering-os'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.symlinkSync(path.join(root, 'src'), path.join(root, '.engineering-os', 'escape'), 'dir');
  const run = permittedRun();
  const check = authorizeApplicationMutation({
    root,
    filePath: '.engineering-os/escape/App.tsx',
    run,
    eosInitialized: true,
  });
  assert.equal(check.ok, false);
  assert.match(check.reason, /resolves outside/i);
});

test('isEngineeringOsPath denies nested symlink escape', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  fs.mkdirSync(path.join(root, '.engineering-os', 'nested'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.symlinkSync(path.join(root, 'src'), path.join(root, '.engineering-os', 'nested', 'link'), 'dir');
  assert.equal(isEngineeringOsPath('.engineering-os/nested/link/App.tsx', root), false);
});

test('isImplementationPermitted rejects stale contract-approval from prior run', () => {
  const run = permittedRun();
  run.gates['contract-approval'] = { status: 'approved', run_id: 'prior-run' };
  const check = isImplementationPermitted(run);
  assert.equal(check.ok, false);
  assert.match(check.reason, /contract-approval is not bound to the current run/i);
});

test('isImplementationPermitted rejects stale architecture-approval from prior run', () => {
  const run = permittedRun({ flags: { architectural_impact: true } });
  run.gates['architecture-approval'] = { status: 'approved', run_id: 'prior-run' };
  const check = isImplementationPermitted(run);
  assert.equal(check.ok, false);
  assert.match(check.reason, /architecture-approval is not bound to the current run/i);
});

test('classifyShellCommand treats empty command as unresolved', () => {
  const classified = classifyShellCommand('');
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.UNRESOLVED);
});

test('classifyShellCommand treats whitespace-only command as unresolved', () => {
  const classified = classifyShellCommand('   ');
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.UNRESOLVED);
});

test('evaluateGuardHookRequest denies empty shell command during guarded workflow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { command: '' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, false);
});

test('evaluateGuardHookRequest denies npm run build during guarded workflow', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const result = evaluateGuardHookRequest({
    payload: { command: 'npm run build' },
    root,
    run,
    eosInitialized: true,
    hookKind: 'shell',
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /interpreter|fail-closed/i);
});

test('classifyMcpOperation treats download with path as write-like governed mutation', () => {
  const classified = classifyMcpOperation('download_assets', { path: 'src/assets/logo.png' });
  assert.equal(classified.classification, MUTATION_REQUEST_CLASS.GOVERNED);
});

test('isImplementationPermitted requires implementation_entered_at in implement phase', () => {
  const run = permittedRun();
  delete run.implementation_entered_at;
  const check = isImplementationPermitted(run);
  assert.equal(check.ok, false);
  assert.match(check.reason, /implementation entry not recorded/i);
});

test('canEnterImplementPhase rejects approved gate without run_id binding', () => {
  const run = permittedRun({
    current_phase: 'approve',
    implementation_entered_at: undefined,
    gates: {
      'plan-approval': { status: 'approved' },
      'contract-approval': { status: 'approved', run_id: 'run-1' },
    },
  });
  assert.equal(canEnterImplementPhase(run).ok, false);
});

test('advanceRunToPhase cannot jump to implement without gate approvals', () => {
  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const run = {
    id: 'run-jump',
    status: 'active',
    current_phase: 'plan',
    phase_index: 3,
    completed_phases: [],
    gates: {},
    workflow_decisions: {},
    orchestration: { blockers: [] },
  };
  assert.throws(() => advanceRunToPhase(run, workflow, 'implement'), /Cannot advance to implement/);
});

test('classifyShellCommand requires every compound segment to be proven safe', () => {
  assert.equal(classifyShellCommand('git status && npm test').classification, MUTATION_REQUEST_CLASS.READ_ONLY);
  assert.equal(classifyShellCommand('git status; make build').classification, MUTATION_REQUEST_CLASS.UNRESOLVED);
  assert.equal(classifyShellCommand('git status || touch src/recovered').classification, MUTATION_REQUEST_CLASS.GOVERNED);
  assert.equal(classifyShellCommand('git diff | tee src/diff.txt').classification, MUTATION_REQUEST_CLASS.GOVERNED);
});

test('classifyShellCommand denies opaque execution forms', () => {
  const unresolved = [
    'echo $(touch src/x)',
    'echo `touch src/x`',
    'cat <<EOF > src/x\nhello\nEOF',
    'find . -delete',
    'find . -exec rm {} +',
    'find . -exec sh -c "rm x" \\;',
    'sh -c "touch src/x"',
    'git apply change.patch',
    'patch < change.patch',
  ];
  for (const command of unresolved) {
    assert.equal(classifyShellCommand(command).classification, MUTATION_REQUEST_CLASS.UNRESOLVED, command);
  }
});

test('classifyShellCommand permits only exact known-safe package test commands', () => {
  for (const command of ['node --test', 'npm test', 'npm run test']) {
    assert.equal(classifyShellCommand(command).classification, MUTATION_REQUEST_CLASS.READ_ONLY, command);
  }
  for (const command of [
    'node --test engine/src/guard.test.js',
    'npm exec test',
    'npx test',
    'pnpm test',
    'pnpm run test',
    'yarn test',
    'bun test',
  ]) {
    assert.equal(classifyShellCommand(command).classification, MUTATION_REQUEST_CLASS.UNRESOLVED, command);
  }
});

test('authorizeApplicationMutation denies traversal and outside absolute paths', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  assert.equal(authorizeApplicationMutation({
    root,
    filePath: '../outside.ts',
    run: permittedRun(),
    eosInitialized: true,
  }).ok, false);
  assert.equal(authorizeApplicationMutation({
    root,
    filePath: path.join(os.tmpdir(), 'outside.ts'),
    run: permittedRun(),
    eosInitialized: true,
  }).ok, false);
});

test('application symlink alias into EOS retains engineering-os scope', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  fs.mkdirSync(path.join(root, '.engineering-os', 'artifacts'), { recursive: true });
  fs.symlinkSync(path.join(root, '.engineering-os', 'artifacts'), path.join(root, 'artifacts-alias'), 'dir');
  const result = authorizeApplicationMutation({
    root,
    filePath: 'artifacts-alias/plan.md',
    run: permittedRun({ current_phase: 'approve' }),
    eosInitialized: true,
  });
  assert.equal(result.ok, true);
  assert.equal(result.scope, 'engineering-os');
});

test('EditNotebook and shell aliases are governed mutation tools', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const planningRun = permittedRun({ current_phase: 'approve' });
  const notebook = evaluateGuardHookRequest({
    payload: { tool_name: 'EditNotebook', tool_input: { target_notebook: 'src/demo.ipynb' } },
    root,
    run: planningRun,
    eosInitialized: true,
  });
  assert.equal(notebook.ok, false);
  for (const tool_name of ['Shell', 'run_terminal_cmd', 'Bash']) {
    const result = evaluateGuardHookRequest({
      payload: { tool_name, tool_input: { command: 'touch src/x' } },
      root,
      run: planningRun,
      eosInitialized: true,
    });
    assert.equal(result.ok, false, tool_name);
  }
});

test('dynamic local tools fail closed without blocking known nonmutation file tools', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-'));
  const run = permittedRun({ current_phase: 'approve' });
  const opaque = evaluateGuardHookRequest({
    payload: {
      tool_name: 'CallDynamicTool',
      tool_input: { toolName: 'opaque_local_action', arguments: { path: 'src/x' } },
    },
    root,
    run,
    eosInitialized: true,
  });
  assert.equal(opaque.ok, false);
  const read = evaluateGuardHookRequest({
    payload: { tool_name: 'ReadFile', tool_input: { path: 'src/x' } },
    root,
    run,
    eosInitialized: true,
  });
  assert.equal(read.ok, true);
});

test('MCP download destinations are governed and unknown path tools remain unresolved', () => {
  for (const toolName of ['download_asset', 'download_assets', 'download_file', 'download_and_extract']) {
    assert.equal(
      classifyMcpOperation(toolName, { downloadPath: 'src/download.bin' }).classification,
      MUTATION_REQUEST_CLASS.GOVERNED,
      toolName
    );
  }
  assert.equal(
    classifyMcpOperation('opaque_action', { path: 'src/x' }).classification,
    MUTATION_REQUEST_CLASS.UNRESOLVED
  );
});

test('git output targets are governed and mixed read-only prefixes cannot hide writes', () => {
  const output = classifyShellCommand('git diff --output=src/change.diff');
  assert.equal(output.classification, MUTATION_REQUEST_CLASS.GOVERNED);
  assert.deepEqual(output.paths, ['src/change.diff']);
  assert.equal(
    classifyShellCommand('git status && npm run test').classification,
    MUTATION_REQUEST_CLASS.READ_ONLY
  );
});

test('mutation tools reject explicitly null paths', () => {
  const result = evaluateGuardHookRequest({
    payload: { tool_name: 'Write', tool_input: { path: null, file_path: 'src/x' } },
    root: fs.mkdtempSync(path.join(os.tmpdir(), 'eos-guard-')),
    run: permittedRun(),
    eosInitialized: true,
  });
  assert.equal(result.ok, false);
});
