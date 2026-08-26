import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  ADAPTER_ENFORCEMENT_PROFILES,
  analyzeCursorHookConfiguration,
  ENFORCEMENT_TIER,
  buildEnforcementCapabilitiesReport,
  detectConsumerEnforcement,
  preToolUseMatcherCoversRequiredTools,
  REQUIRED_PRE_TOOL_USE_MATCHER,
} from './mutationEnforcement.js';
import { evaluateMutationAuthorization } from './guard.js';

function initEosRoot(root) {
  fs.mkdirSync(path.join(root, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(root, '.engineering-os/state.json'),
    JSON.stringify({ version: 1, initialized_at: 't', capabilities: {}, active_run: null })
  );
}

function writeHooks(root, hooksConfig) {
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cursor/hooks.json'), JSON.stringify(hooksConfig));
}

function fullCursorHooks(overrides = {}) {
  return {
    version: 1,
    hooks: {
      preToolUse: [
        {
          command: 'eos guard hook',
          matcher: REQUIRED_PRE_TOOL_USE_MATCHER,
          failClosed: true,
          ...overrides.preToolUse,
        },
      ],
      beforeShellExecution: [{ command: 'eos guard hook --shell', failClosed: true, ...overrides.beforeShellExecution }],
      beforeMCPExecution: [{ command: 'eos guard hook --mcp', failClosed: true, ...overrides.beforeMCPExecution }],
    },
  };
}

test('adapter profiles declare hard hooks only for Cursor', () => {
  assert.equal(ADAPTER_ENFORCEMENT_PROFILES.cursor.hardMutationInterception, true);
  assert.equal(ADAPTER_ENFORCEMENT_PROFILES.cursor.unsupportedForHardEnforcement, false);
  assert.equal(ADAPTER_ENFORCEMENT_PROFILES['claude-code'].hardMutationInterception, false);
  assert.equal(ADAPTER_ENFORCEMENT_PROFILES['claude-code'].unsupportedForHardEnforcement, true);
  assert.equal(ADAPTER_ENFORCEMENT_PROFILES.copilot.hardMutationInterception, false);
  assert.equal(ADAPTER_ENFORCEMENT_PROFILES.copilot.unsupportedForHardEnforcement, true);
  assert.equal(ADAPTER_ENFORCEMENT_PROFILES.generic.hardMutationInterception, false);
  assert.equal(ADAPTER_ENFORCEMENT_PROFILES.generic.unsupportedForHardEnforcement, true);
});

test('detectConsumerEnforcement reports inactive when EOS not initialized', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.effective_tier, ENFORCEMENT_TIER.INACTIVE);
  assert.equal(detected.current_adapter_hard_enforcement, false);
});

test('detectConsumerEnforcement reports engine-only when EOS init without hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.effective_tier, ENFORCEMENT_TIER.ENGINE_ONLY);
  assert.equal(detected.cursor_hooks_wired, false);
  assert.equal(detected.hard_hook_complete, false);
  assert.equal(detected.current_adapter_hard_enforcement, false);
});

test('detectConsumerEnforcement is not hard-hook with only preToolUse', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, { hooks: { preToolUse: [{ command: 'eos guard hook' }] } });
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.effective_tier, ENFORCEMENT_TIER.ENGINE_ONLY);
  assert.equal(detected.hard_hook_complete, false);
  assert.equal(detected.partially_installed, true);
  assert.deepEqual(detected.missing_hook_events, ['preToolUse', 'beforeShellExecution', 'beforeMCPExecution']);
});

test('detectConsumerEnforcement is not hard-hook with preToolUse and beforeShellExecution only', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, {
    hooks: {
      preToolUse: [{ command: 'eos guard hook' }],
      beforeShellExecution: [{ command: 'eos guard hook --shell' }],
    },
  });
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.effective_tier, ENFORCEMENT_TIER.ENGINE_ONLY);
  assert.equal(detected.hard_hook_complete, false);
  assert.deepEqual(detected.missing_hook_events, ['preToolUse', 'beforeShellExecution', 'beforeMCPExecution']);
});

test('detectConsumerEnforcement is not hard-hook when beforeMCPExecution missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, {
    hooks: {
      preToolUse: [{ command: 'eos guard hook', matcher: REQUIRED_PRE_TOOL_USE_MATCHER, failClosed: true }],
      beforeShellExecution: [{ command: 'eos guard hook --shell', failClosed: true }],
    },
  });
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.hard_hook_complete, false);
  assert.deepEqual(detected.missing_hook_events, ['beforeMCPExecution']);
});

test('detectConsumerEnforcement reports hard-hook when all required hooks wired', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, fullCursorHooks());
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.effective_tier, ENFORCEMENT_TIER.HARD_HOOK);
  assert.equal(detected.hard_hook_complete, true);
  assert.equal(detected.current_adapter_hard_enforcement, true);
  assert.deepEqual(detected.missing_hook_events, []);
});

test('detectConsumerEnforcement is not hard-hook when hook exists but is not wired to EOS', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, {
    hooks: {
      preToolUse: [{ command: 'echo noop' }],
      beforeShellExecution: [{ command: 'echo noop' }],
      beforeMCPExecution: [{ command: 'echo noop' }],
    },
  });
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.effective_tier, ENFORCEMENT_TIER.ENGINE_ONLY);
  assert.equal(detected.hard_hook_complete, false);
});

test('detectConsumerEnforcement fails safely on malformed hook configuration', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  fs.mkdirSync(path.join(root, '.cursor'), { recursive: true });
  fs.writeFileSync(path.join(root, '.cursor/hooks.json'), '{not-json');
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.effective_tier, ENFORCEMENT_TIER.ENGINE_ONLY);
  assert.equal(detected.hard_hook_complete, false);
  assert.equal(detected.hooks_malformed, true);
});

test('analyzeCursorHookConfiguration rejects preToolUse wired to shell flag', () => {
  const analysis = analyzeCursorHookConfiguration({
    hooks: {
      preToolUse: [{ command: 'eos guard hook --shell' }],
      beforeShellExecution: [{ command: 'eos guard hook --shell' }],
      beforeMCPExecution: [{ command: 'eos guard hook --mcp' }],
    },
  });
  assert.equal(analysis.hard_hook_complete, false);
  assert.ok(analysis.missing_events.includes('preToolUse'));
});

test('capabilities report does not claim IDE-independent hard enforcement without hooks', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  const report = buildEnforcementCapabilitiesReport(root, null);
  assert.equal(report.enforcement.ide_independent_hard_enforcement, false);
  assert.equal(report.enforcement.current_adapter_hard_enforcement, false);
  assert.equal(report.enforcement.engine_only_enforcement, true);
  assert.match(report.honesty.statement, /engine-only|NOT hard-blocked/i);
  const claude = report.adapters.find((adapter) => adapter.id === 'claude-code');
  const copilot = report.adapters.find((adapter) => adapter.id === 'copilot');
  const generic = report.adapters.find((adapter) => adapter.id === 'generic');
  assert.equal(claude.unsupported_for_hard_enforcement, true);
  assert.equal(copilot.unsupported_for_hard_enforcement, true);
  assert.equal(generic.unsupported_for_hard_enforcement, true);
  assert.equal(report.adapters.find((adapter) => adapter.id === 'cursor').unsupported_for_hard_enforcement, false);
});

test('capabilities report separates current adapter hard enforcement from IDE-independent', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, fullCursorHooks());
  const report = buildEnforcementCapabilitiesReport(root, null);
  assert.equal(report.enforcement.current_adapter_hard_enforcement, true);
  assert.equal(report.enforcement.ide_independent_hard_enforcement, false);
  assert.equal(report.consumer.effective_tier, ENFORCEMENT_TIER.HARD_HOOK);
  assert.match(report.honesty.statement, /Other adapters remain engine-only/i);
});

test('capabilities report notes partial hook installation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, { hooks: { preToolUse: [{ command: 'eos guard hook' }] } });
  const report = buildEnforcementCapabilitiesReport(root, null);
  assert.equal(report.enforcement.current_adapter_hard_enforcement, false);
  assert.match(report.honesty.statement, /Partial Cursor hook installation/i);
});

test('evaluateMutationAuthorization is the shared engine entry point', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  const result = evaluateMutationAuthorization({
    root,
    filePath: 'src/App.tsx',
    run: null,
    eosInitialized: true,
  });
  assert.equal(result.ok, false);
});

test('preToolUseMatcherCoversRequiredTools validates reference matcher', () => {
  assert.equal(preToolUseMatcherCoversRequiredTools(REQUIRED_PRE_TOOL_USE_MATCHER), true);
  assert.equal(preToolUseMatcherCoversRequiredTools('Write|StrReplace'), false);
});

test('detectConsumerEnforcement is not hard-hook when failClosed is false', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, fullCursorHooks({ preToolUse: { failClosed: false } }));
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.effective_tier, ENFORCEMENT_TIER.ENGINE_ONLY);
  assert.equal(detected.hard_hook_complete, false);
});

test('detectConsumerEnforcement is not hard-hook when preToolUse matcher missing', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, {
    hooks: {
      preToolUse: [{ command: 'eos guard hook', failClosed: true }],
      beforeShellExecution: [{ command: 'eos guard hook --shell', failClosed: true }],
      beforeMCPExecution: [{ command: 'eos guard hook --mcp', failClosed: true }],
    },
  });
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.hard_hook_complete, false);
});

test('detectConsumerEnforcement is not hard-hook when preToolUse matcher incomplete', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, {
    hooks: {
      preToolUse: [{ command: 'eos guard hook', matcher: 'Write|StrReplace', failClosed: true }],
      beforeShellExecution: [{ command: 'eos guard hook --shell', failClosed: true }],
      beforeMCPExecution: [{ command: 'eos guard hook --mcp', failClosed: true }],
    },
  });
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.hard_hook_complete, false);
});

test('detectConsumerEnforcement is not hard-hook when shell hook command incorrect', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, fullCursorHooks({ beforeShellExecution: { command: 'eos guard hook --mcp' } }));
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.hard_hook_complete, false);
  assert.ok(detected.missing_hook_events.includes('beforeShellExecution'));
});

test('detectConsumerEnforcement is not hard-hook when MCP hook command incorrect', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, fullCursorHooks({ beforeMCPExecution: { command: 'eos guard hook --shell' } }));
  const detected = detectConsumerEnforcement(root);
  assert.equal(detected.hard_hook_complete, false);
  assert.ok(detected.missing_hook_events.includes('beforeMCPExecution'));
});

test('analyzeCursorHookConfiguration accepts complete valid hook configuration', () => {
  const analysis = analyzeCursorHookConfiguration(fullCursorHooks());
  assert.equal(analysis.hard_hook_complete, true);
  assert.deepEqual(analysis.missing_events, []);
});

test('required matcher covers notebooks, shell aliases, and dynamic tools', () => {
  for (const tool of ['EditNotebook', 'Shell', 'run_terminal_cmd', 'Bash', 'CallDynamicTool']) {
    assert.match(tool, new RegExp(REQUIRED_PRE_TOOL_USE_MATCHER));
  }
  assert.equal(
    preToolUseMatcherCoversRequiredTools('Write|StrReplace|Delete|ApplyPatch|EditNotebook|Shell'),
    false
  );
});

test('capabilities report publishes truthful complete hook requirements', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-mutcap-'));
  initEosRoot(root);
  writeHooks(root, fullCursorHooks());
  const report = buildEnforcementCapabilitiesReport(root, null);
  assert.equal(report.consumer.effective_tier, ENFORCEMENT_TIER.HARD_HOOK);
  assert.deepEqual(
    report.engine.required_cursor_hooks.map((hook) => hook.event),
    ['preToolUse', 'beforeShellExecution', 'beforeMCPExecution']
  );
  for (const hook of report.engine.required_cursor_hooks) {
    assert.equal(hook.failClosed, true);
    assert.match(hook.command, /^eos guard hook/);
  }
  assert.equal(report.engine.required_cursor_hooks[0].matcher, REQUIRED_PRE_TOOL_USE_MATCHER);
});
