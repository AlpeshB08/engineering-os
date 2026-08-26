/**
 * Adapter mutation enforcement profiles and consumer detection.
 * The engine (guard.js) is the single authorization source; adapters delegate to it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { isEosInitialized } from './guard.js';
import { isImplementationPermitted, buildGuardManifest } from './guard.js';

export const ENFORCEMENT_TIER = {
  /** No EOS in consumer repo — guard inactive */
  INACTIVE: 'inactive',
  /** EOS initialized; CLI/workflow gates only — no tool interception */
  ENGINE_ONLY: 'engine-only',
  /** All required fail-closed hooks installed and correctly wired */
  HARD_HOOK: 'hard-hook',
};

/** Required mutation tools that preToolUse matcher must cover. */
export const REQUIRED_PRE_TOOL_USE_MATCHER_TOOLS = [
  'Write',
  'StrReplace',
  'Delete',
  'ApplyPatch',
  'EditNotebook',
  'Shell',
  'run_terminal_cmd',
  'Bash',
  'CallDynamicTool',
];

/** Reference matcher shipped with the Cursor adapter hook pack. */
export const REQUIRED_PRE_TOOL_USE_MATCHER =
  'Write|StrReplace|Delete|ApplyPatch|EditNotebook|Shell|run_terminal_cmd|Bash|CallDynamicTool';

/** Required Cursor hook events and their expected eos guard wiring. */
export const REQUIRED_CURSOR_HOOK_SPECS = [
  {
    event: 'preToolUse',
    label: 'preToolUse (file tools + Shell tool)',
    commandPattern: /\beos\s+guard\s+hook(?:\s|$)/,
    forbidPattern: /--(?:shell|mcp)\b/,
    requiresMatcher: true,
  },
  {
    event: 'beforeShellExecution',
    label: 'beforeShellExecution',
    commandPattern: /\beos\s+guard\s+hook\s+--shell\b/,
  },
  {
    event: 'beforeMCPExecution',
    label: 'beforeMCPExecution',
    commandPattern: /\beos\s+guard\s+hook\s+--mcp\b/,
  },
];

export const MUTATION_PATH_COVERAGE = {
  file_tools: {
    id: 'file_tools',
    tools: ['Write', 'StrReplace', 'Delete', 'ApplyPatch', 'EditNotebook', 'CallDynamicTool'],
    hookEvent: 'preToolUse',
    engineEvaluation: 'extractMutationPathsFromToolInput',
    failClosed: true,
    knownGaps: ['Tool omits path → denied fail-closed when hook installed'],
  },
  shell_redirects: {
    id: 'shell_redirects',
    patterns: ['>', '>>', 'tee', 'sed -i', 'rm', 'mv', 'cp', 'touch', 'patch', 'find -delete/-exec'],
    hookEvents: ['beforeShellExecution', 'preToolUse(Shell|run_terminal_cmd|Bash)'],
    engineEvaluation: 'classifyShellCommand',
    failClosed: true,
    knownGaps: [
      'Opaque interpreters, substitutions, heredocs, package scripts, and unknown compound segments are denied unresolved',
      'Only exact known-safe test commands are classified read-only',
    ],
  },
  mcp_tools: {
    id: 'mcp_tools',
    hookEvent: 'beforeMCPExecution',
    engineEvaluation: 'classifyMcpOperation',
    failClosed: true,
    knownGaps: ['Resolved-path MCP mutations still require isImplementationPermitted'],
  },
  workflow_cli: {
    id: 'workflow_cli',
    commands: ['eos complete-phase', 'eos gate plan-approval --approve'],
    enforcement: 'engine-only',
    knownGaps: ['Does not intercept direct agent file tools without hooks'],
  },
};

/** Static adapter profiles shipped with Engineering OS. */
export const ADAPTER_ENFORCEMENT_PROFILES = {
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    hardMutationInterception: true,
    hookPack: 'adapters/cursor/.cursor/hooks.json',
    requiredHookEvents: REQUIRED_CURSOR_HOOK_SPECS.map((s) => s.event),
    enforcementWhenFullyInstalled: ENFORCEMENT_TIER.HARD_HOOK,
    enforcementWhenNotInstalled: ENFORCEMENT_TIER.ENGINE_ONLY,
    installDocs: 'adapters/cursor/README.md',
    unsupportedForHardEnforcement: false,
  },
  'claude-code': {
    id: 'claude-code',
    name: 'Claude Code',
    hardMutationInterception: false,
    hookPack: null,
    requiredHookEvents: [],
    enforcementWhenFullyInstalled: ENFORCEMENT_TIER.ENGINE_ONLY,
    enforcementWhenNotInstalled: ENFORCEMENT_TIER.ENGINE_ONLY,
    installDocs: 'adapters/claude-code/README.md',
    limitation:
      'No fail-closed mutation hooks ship with this adapter. Engine CLI gates apply; agent tool mutations are not intercepted. Governed hard enforcement is unsupported on this adapter.',
    unsupportedForHardEnforcement: true,
  },
  copilot: {
    id: 'copilot',
    name: 'GitHub Copilot',
    hardMutationInterception: false,
    hookPack: null,
    requiredHookEvents: [],
    enforcementWhenFullyInstalled: ENFORCEMENT_TIER.ENGINE_ONLY,
    enforcementWhenNotInstalled: ENFORCEMENT_TIER.ENGINE_ONLY,
    installDocs: 'adapters/copilot/README.md',
    limitation:
      'No fail-closed mutation hooks ship with this adapter. Engine CLI gates apply; agent tool mutations are not intercepted. Governed hard enforcement is unsupported on this adapter.',
    unsupportedForHardEnforcement: true,
  },
  generic: {
    id: 'generic',
    name: 'Generic (Cline, Roo, Windsurf, …)',
    hardMutationInterception: false,
    hookPack: null,
    requiredHookEvents: [],
    enforcementWhenFullyInstalled: ENFORCEMENT_TIER.ENGINE_ONLY,
    enforcementWhenNotInstalled: ENFORCEMENT_TIER.ENGINE_ONLY,
    installDocs: 'adapters/generic/README.md',
    limitation:
      'No fail-closed mutation hooks ship with this adapter. Hosts with Cursor-compatible hooks may reuse adapters/cursor/.cursor/hooks.json. Governed hard enforcement is unsupported until those hooks are installed.',
    unsupportedForHardEnforcement: true,
  },
};

export const MUTATION_AUTHORIZATION_INVARIANT = {
  description: 'Governed application mutation is permitted only when all conditions hold.',
  conditions: [
    'active run exists with status === "active"',
    'current_phase === "implement"',
    'implementation_entered_at is recorded (via eos complete-phase)',
    'all required workflow_decisions are answered',
    'no orchestration blockers exist',
    'plan-approval is approved with run_id matching current run',
    'contract-approval is approved with run_id matching current run',
    'architecture-approval is approved with run_id matching current run when architectural_impact requires it',
    'isImplementationPermitted(run) === true',
    '--force cannot bypass any of the above',
  ],
  allowedWithoutInvariant: [
    '.engineering-os/** artifact paths during an active workflow, excluding engine-managed state.json and staged setup manifests',
  ],
  denyWhenEosInitializedWithoutActiveRun: true,
};

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function hookEntryMatchesSpec(entry, spec) {
  const cmd = String(entry?.command || '');
  if (!spec.commandPattern.test(cmd)) return false;
  if (spec.forbidPattern && spec.forbidPattern.test(cmd)) return false;
  if (entry?.failClosed !== true) return false;
  if (spec.requiresMatcher && !preToolUseMatcherCoversRequiredTools(entry?.matcher)) return false;
  return true;
}

export function preToolUseMatcherCoversRequiredTools(matcher) {
  if (!matcher || typeof matcher !== 'string') return false;
  try {
    const re = new RegExp(matcher);
    return REQUIRED_PRE_TOOL_USE_MATCHER_TOOLS.every((tool) => re.test(tool));
  } catch {
    return false;
  }
}

/**
 * Analyze Cursor hooks.json for complete EOS mutation interception wiring.
 */
export function analyzeCursorHookConfiguration(hooksConfig) {
  if (!hooksConfig || typeof hooksConfig !== 'object') {
    return {
      valid: false,
      malformed: true,
      hard_hook_complete: false,
      partially_installed: false,
      installed_events: [],
      wired_events: [],
      missing_events: REQUIRED_CURSOR_HOOK_SPECS.map((s) => s.event),
      hook_details: [],
    };
  }

  const hooks = hooksConfig.hooks;
  if (!hooks || typeof hooks !== 'object') {
    return {
      valid: false,
      malformed: true,
      hard_hook_complete: false,
      partially_installed: false,
      installed_events: [],
      wired_events: [],
      missing_events: REQUIRED_CURSOR_HOOK_SPECS.map((s) => s.event),
      hook_details: [],
    };
  }

  const hookDetails = [];
  const wiredEvents = [];
  const installedEvents = [];

  for (const spec of REQUIRED_CURSOR_HOOK_SPECS) {
    const entries = hooks[spec.event];
    const hasEntries = Array.isArray(entries) && entries.length > 0;
    if (hasEntries) installedEvents.push(spec.event);

    const wired = hasEntries && entries.some((entry) => hookEntryMatchesSpec(entry, spec));
    if (wired) wiredEvents.push(spec.event);

    hookDetails.push({
      event: spec.event,
      label: spec.label,
      installed: hasEntries,
      wired,
      fail_closed: hasEntries ? entries.some((entry) => entry?.failClosed === true) : false,
      matcher_valid:
        spec.event !== 'preToolUse'
          ? null
          : hasEntries && entries.some((entry) => preToolUseMatcherCoversRequiredTools(entry?.matcher)),
      entries: hasEntries ? entries.map((e) => String(e?.command || '')) : [],
    });
  }

  const missingEvents = REQUIRED_CURSOR_HOOK_SPECS.filter((s) => !wiredEvents.includes(s.event)).map(
    (s) => s.event
  );
  const partiallyInstalled = installedEvents.length > 0 && missingEvents.length > 0;
  const hardHookComplete = missingEvents.length === 0;

  return {
    valid: true,
    malformed: false,
    hard_hook_complete: hardHookComplete,
    partially_installed: partiallyInstalled,
    installed_events: installedEvents,
    wired_events: wiredEvents,
    missing_events: missingEvents,
    hook_details: hookDetails,
  };
}

/** Whether every supported adapter ships hard mutation hooks (currently false). */
export function allSupportedAdaptersShipHardHooks() {
  return Object.values(ADAPTER_ENFORCEMENT_PROFILES).every((profile) => profile.hardMutationInterception);
}

/**
 * Detect mutation enforcement actually present in a consumer repository.
 */
export function detectConsumerEnforcement(root) {
  const eosInitialized = isEosInitialized(root);
  if (!eosInitialized) {
    return {
      eos_initialized: false,
      effective_tier: ENFORCEMENT_TIER.INACTIVE,
      engine_only_enforcement: false,
      current_adapter_hard_enforcement: false,
      cursor_hooks_installed: false,
      cursor_hooks_wired: false,
      hard_hook_complete: false,
      partially_installed: false,
      hook_events: [],
      missing_hook_events: REQUIRED_CURSOR_HOOK_SPECS.map((s) => s.event),
      hooks_malformed: false,
    };
  }

  const hooksPath = path.join(root, '.cursor/hooks.json');
  const hooksConfig = fs.existsSync(hooksPath) ? readJsonFile(hooksPath) : null;
  const hookAnalysis = analyzeCursorHookConfiguration(hooksConfig);

  return {
    eos_initialized: true,
    effective_tier: hookAnalysis.hard_hook_complete ? ENFORCEMENT_TIER.HARD_HOOK : ENFORCEMENT_TIER.ENGINE_ONLY,
    engine_only_enforcement: true,
    current_adapter_hard_enforcement: hookAnalysis.hard_hook_complete,
    cursor_hooks_installed: Boolean(hooksConfig && hookAnalysis.valid),
    cursor_hooks_wired: hookAnalysis.wired_events.length > 0,
    hard_hook_complete: hookAnalysis.hard_hook_complete,
    partially_installed: hookAnalysis.partially_installed,
    hook_events: hookAnalysis.wired_events,
    missing_hook_events: hookAnalysis.missing_events,
    hooks_malformed: hookAnalysis.malformed,
    hook_details: hookAnalysis.hook_details,
    hooks_path: hooksConfig ? hooksPath : null,
  };
}

export function buildEnforcementCapabilitiesReport(root, run = null) {
  const consumer = detectConsumerEnforcement(root);
  const manifest = run ? buildGuardManifest(run) : null;
  const permission = run ? isImplementationPermitted(run) : { ok: false, reason: 'No active run.' };

  const adapters = Object.values(ADAPTER_ENFORCEMENT_PROFILES).map((profile) => ({
    id: profile.id,
    name: profile.name,
    hard_mutation_interception_available: profile.hardMutationInterception,
    unsupported_for_hard_enforcement: Boolean(profile.unsupportedForHardEnforcement),
    effective_enforcement_when_fully_installed:
      profile.id === 'cursor' && consumer.hard_hook_complete
        ? ENFORCEMENT_TIER.HARD_HOOK
        : profile.enforcementWhenFullyInstalled,
    limitation: profile.limitation || null,
    install_docs: profile.installDocs,
  }));

  const ideIndependentHardEnforcement =
    allSupportedAdaptersShipHardHooks() && consumer.hard_hook_complete;

  return {
    engine: {
      authorization_source: 'engine/src/guard.js',
      commands: ['eos guard implementation', 'eos guard hook', 'eos guard capabilities'],
      invariant: MUTATION_AUTHORIZATION_INVARIANT,
      mutation_path_coverage: MUTATION_PATH_COVERAGE,
      required_cursor_hooks: REQUIRED_CURSOR_HOOK_SPECS.map((s) => ({
        event: s.event,
        label: s.label,
        command: s.event === 'preToolUse'
          ? 'eos guard hook'
          : s.event === 'beforeShellExecution'
            ? 'eos guard hook --shell'
            : 'eos guard hook --mcp',
        matcher: s.requiresMatcher ? REQUIRED_PRE_TOOL_USE_MATCHER : null,
        failClosed: true,
      })),
    },
    consumer: {
      ...consumer,
      application_mutation_permitted: permission.ok,
      implementation_permitted: permission.ok,
      guard_manifest: manifest,
    },
    adapters,
    enforcement: {
      current_adapter_hard_enforcement: consumer.current_adapter_hard_enforcement,
      engine_only_enforcement: consumer.engine_only_enforcement,
      ide_independent_hard_enforcement: ideIndependentHardEnforcement,
      effective_tier: consumer.effective_tier,
    },
    honesty: {
      current_adapter_hard_enforcement: consumer.current_adapter_hard_enforcement,
      engine_only_enforcement: consumer.engine_only_enforcement,
      ide_independent_hard_enforcement: ideIndependentHardEnforcement,
      statement: buildHonestyStatement(consumer, ideIndependentHardEnforcement),
    },
  };
}

function buildHonestyStatement(consumer, ideIndependent) {
  if (!consumer.eos_initialized) {
    return 'Engineering OS guard is inactive — no governed mutation enforcement.';
  }
  if (consumer.hard_hook_complete) {
    return 'Cursor adapter hard mutation hooks are fully installed and wired. Other adapters remain engine-only.';
  }
  if (consumer.hooks_malformed && !consumer.cursor_hooks_installed) {
    return 'Cursor hooks.json is missing or malformed. Effective enforcement is engine-only.';
  }
  if (consumer.partially_installed) {
    return `Partial Cursor hook installation detected (missing: ${consumer.missing_hook_events.join(', ')}). Effective enforcement is engine-only until all required hooks are wired.`;
  }
  if (consumer.hooks_malformed) {
    return 'Cursor hooks.json is missing or malformed. Effective enforcement is engine-only.';
  }
  if (ideIndependent) {
    return 'IDE-independent hard mutation interception is active across all supported adapters.';
  }
  return 'Only engine-level authorization is active. Agent tool mutations are NOT hard-blocked until all required Cursor fail-closed hooks are installed and wired.';
}

/** @deprecated Use analyzeCursorHookConfiguration */
export function hooksReferenceEosGuard(hooksConfig = {}) {
  const analysis = analyzeCursorHookConfiguration(hooksConfig);
  return analysis.wired_events.length > 0;
}
