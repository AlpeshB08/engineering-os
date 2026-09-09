/**
 * Implementation mutation guard — authoritative fail-closed boundary for governed application code.
 * Used by `eos guard implementation`, `eos guard hook`, and workflow permission checks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { eosDir } from './paths.js';
import { fileExists, statePath } from './paths.js';
import { canPassDecisionGate, getPendingDecisions } from './workflowDecisions.js';

export const GUARD_SCOPE = {
  INACTIVE: 'inactive',
  ENGINEERING_OS: 'engineering-os',
  APPLICATION: 'application',
};

export const MUTATION_REQUEST_CLASS = {
  READ_ONLY: 'read_only',
  GOVERNED: 'governed_mutation',
  UNRESOLVED: 'unresolved_mutation',
};

const FILE_MUTATION_TOOLS = new Set(['Write', 'StrReplace', 'Delete', 'ApplyPatch', 'EditNotebook']);
const SHELL_TOOLS = new Set(['Shell', 'run_terminal_cmd', 'Bash']);
const DYNAMIC_TOOL_NAMES = new Set(['CallDynamicTool', 'call_mcp_tool', 'use_mcp_tool']);
const KNOWN_NON_MUTATION_TOOLS = new Set([
  'ReadFile',
  'Read',
  'Search',
  'List',
  'Find',
  'Glob',
  'rg',
  'ReadLints',
  'WebSearch',
  'WebFetch',
  'TodoWrite',
  'UpdateCurrentStep',
  'AwaitShell',
]);

const SHELL_MUTATION_PATTERNS = [
  /(?:^|\s)(?:>|>>)\s*['"]?([^\s'"|&;><]+)/g,
  /\btee(?:\s+-a)?\s+['"]?([^\s'"|&;]+)/g,
  /\bsed\s+-i\S*\s+(?:['"][^'"]+['"]\s+)?['"]?([^\s'"|&;]+)/g,
  /\brm(?:\s+-[\w-]+)*\s+['"]?([^\s'"|&;]+)/g,
  /\bmv\s+\S+\s+['"]?([^\s'"|&;]+)/g,
  /\bcp\s+\S+\s+['"]?([^\s'"|&;]+)/g,
  /\btouch\s+['"]?([^\s'"|&;]+)/g,
  /\bgit\s+(?:status|log|diff|show)\b[^\n;&|]*\s--output(?:=|\s+)['"]?([^\s'"|&;]+)/g,
];

const READ_ONLY_SHELL_COMMANDS = [
  /^\s*eos(?:\s+(?!guard\s+hook\b)[^\n]*)?\s*$/,
  /^\s*git\s+(?:status|log|diff|show|branch|rev-parse)(?:\s+(?!.*(?:>|<))[^\n]*)?\s*$/,
  // `cd` mutates nothing. Without it, the extremely common `cd <repo> && eos feature …`
  // was denied on its first segment, which blocked the command that starts the governed
  // workflow. Each segment is still classified independently, so `cd x && rm -rf y` is
  // unaffected — the `rm` segment is judged on its own.
  /^\s*cd(?:\s+(?!.*(?:>|<|&|\|))[^\n]*)?\s*$/,
  /^\s*(?:head|tail|less|more|grep|rg|find|ls|pwd|wc|stat|file|which|type)(?:\s+(?!.*(?:>|<))[^\n]*)?\s*$/,
  /^\s*(?:echo|printf|cat)(?:\s+(?!.*(?:>|<))[^\n]*)?\s*$/,
  /^\s*node\s+--test\s*$/,
  /^\s*npm\s+(?:test|run\s+test)\s*$/,
];

const INTERPRETER_MUTATION_PATTERNS = [
  /\b(node|nodejs|python3?|python|ruby|perl)\s+(-e|-c)\s+/,
  /\b(?:eval|bash|sh|zsh)\s+(?:-c\b|['"])/,
  /\bgit\s+(apply|checkout|restore|switch|merge|rebase|commit|add|reset|clean)\b/,
  /\bgit\s+(?:am|cherry-pick|revert|tag|stash|format-patch|archive|bundle|worktree|submodule)\b/,
  /\bpatch\s+/,
  /\bnpm\s+(install|ci|run\b|exec\b|create\b|init\b)\b/,
  /\bpnpm\s+(install|add|run\b|exec\b|create\b)\b/,
  /\byarn\s+(install|add|run\b|create\b)\b/,
  /\bbun\s+(install|add|run\b|create\b)\b/,
  /\bnpx\s+/,
  /\byarn\s+dlx\b/,
  /\bpnpm\s+dlx\b/,
];

const READ_ONLY_MCP_TOOL_PATTERNS = [
  /^(get|fetch|read|search|list|describe|lookup|whoami|metadata|inspect|query|find|browse|view|show|get_)/i,
  /^mcp_auth$/i,
];

const WRITE_LIKE_MCP_TOOL_PATTERN =
  /write|upload|create|update|edit|save|patch|put|delete|remove|generate|send|post|modify|rename|move|copy|add_|set_|delete_|update_|create_|upload_|write_|save_|download_asset|download_file|download_and/i;

const MCP_PATH_KEY_PATTERN = /path|file|filepath|target|destination|uri|downloadPath|download_path/i;

/** Gates that authorize application mutation — must be approved with matching run_id. */
export const IMPLEMENT_AUTHORIZATION_GATES = [
  'plan-approval',
  'contract-approval',
  'architecture-approval',
];

export function isEosInitialized(root) {
  return fileExists(statePath(root));
}

function canonicalRoot(root) {
  const resolved = path.resolve(root);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function canonicalEosRoot(root) {
  const eos = path.resolve(eosDir(root));
  try {
    return fs.realpathSync(eos);
  } catch {
    return eos;
  }
}

function isWithin(parent, candidate) {
  return candidate === parent || candidate.startsWith(`${parent}${path.sep}`);
}

function validateMutationTargetPath(filePath, root) {
  if (!isValidMutationPath(filePath)) {
    return { ok: false, reason: 'Mutation target path is missing, null, or invalid — denied fail-closed.' };
  }
  const trimmed = filePath.trim();
  const relativeSegments = trimmed.split(/[\\/]+/);
  if (!path.isAbsolute(trimmed) && relativeSegments.includes('..')) {
    return { ok: false, reason: 'Mutation target uses parent traversal (..) — denied fail-closed.' };
  }

  const lexicalRoot = path.resolve(root);
  const lexicalPath = path.resolve(lexicalRoot, trimmed);
  if (!isWithin(lexicalRoot, lexicalPath)) {
    return { ok: false, reason: 'Mutation target is outside the consumer root — denied fail-closed.' };
  }

  const resolvedRoot = canonicalRoot(root);
  const canonicalPath = resolvePathForBoundaryCheck(trimmed, root);
  if (!canonicalPath || !isWithin(resolvedRoot, canonicalPath)) {
    return { ok: false, reason: 'Mutation target resolves outside the consumer root — denied fail-closed.' };
  }
  return { ok: true, canonicalPath };
}

/** Resolve symlinks for boundary checks; non-existent tails resolve via nearest existing ancestor. */
export function resolvePathForBoundaryCheck(filePath, root) {
  if (!filePath) return null;
  const abs = path.resolve(root, filePath);
  let suffix = '';
  let current = abs;

  while (current !== path.dirname(current)) {
    try {
      const canonicalBase = fs.realpathSync(current);
      return suffix ? path.normalize(path.join(canonicalBase, suffix)) : canonicalBase;
    } catch (err) {
      if (err?.code !== 'ENOENT') return null;
      suffix = path.join(path.basename(current), suffix);
      current = path.dirname(current);
    }
  }

  try {
    return fs.realpathSync(current);
  } catch {
    return abs;
  }
}

export function isLexicalEngineeringOsPath(filePath, root) {
  if (!isValidMutationPath(filePath)) return false;
  const abs = path.resolve(root, filePath);
  const eos = path.resolve(eosDir(root));
  return isWithin(eos, abs);
}

export function isEosPathTraversalEscape(filePath, root) {
  return isLexicalEngineeringOsPath(filePath, root) && !isEngineeringOsPath(filePath, root);
}

export function isEngineeringOsPath(filePath, root) {
  const validation = validateMutationTargetPath(filePath, root);
  if (!validation.ok) return false;
  const canonicalEos = canonicalEosRoot(root);
  return isWithin(canonicalEos, validation.canonicalPath);
}

export function isProtectedEngineeringOsControlPath(filePath, root) {
  const validation = validateMutationTargetPath(filePath, root);
  if (!validation.ok) return false;
  const canonicalEos = canonicalEosRoot(root);
  if (!isWithin(canonicalEos, validation.canonicalPath)) return false;
  const relative = path.relative(canonicalEos, validation.canonicalPath).split(path.sep).join('/');
  return (
    relative === 'state.json' ||
    /^test-setup-staging\/[^/]+\/manifest\.json$/.test(relative)
  );
}

export function isApplicationMutationPath(filePath, root) {
  return Boolean(filePath) && !isEngineeringOsPath(filePath, root);
}

export function isFileMutationTool(toolName = '') {
  return FILE_MUTATION_TOOLS.has(toolName);
}

export function isShellTool(toolName = '') {
  return SHELL_TOOLS.has(toolName);
}

export function isValidMutationPath(filePath) {
  if (filePath == null || typeof filePath !== 'string') return false;
  const trimmed = filePath.trim();
  return trimmed.length > 0;
}

export function isWriteLikeMcpTool(toolName = '') {
  return WRITE_LIKE_MCP_TOOL_PATTERN.test(String(toolName || ''));
}

export function isReadOnlyMcpTool(toolName = '') {
  const name = String(toolName || '');
  if (!name) return false;
  if (isWriteLikeMcpTool(name)) return false;
  return READ_ONLY_MCP_TOOL_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Pre-entry implement gate — approvals, decisions, blockers (callable from approve phase).
 * Does not require current_phase === implement or implementation_entered_at.
 */
export function canEnterImplementPhase(run) {
  if (!run || run.status !== 'active') {
    return { ok: false, reason: 'No active workflow run.' };
  }

  const decisionGate = canPassDecisionGate(run);
  if (!decisionGate.ok) return decisionGate;

  if (run.blocked || run.orchestration?.blockers?.length) {
    return { ok: false, reason: 'Run is BLOCKED — resolve orchestration blockers first.' };
  }

  const gateCheck = (gateId, label = gateId) => {
    const gate = run.gates?.[gateId];
    if (gate?.status !== 'approved') {
      return { ok: false, reason: `${label} gate not approved.` };
    }
    if (!gate.run_id || gate.run_id !== run.id) {
      return {
        ok: false,
        reason: `${label} is not bound to the current run (missing or stale run_id).`,
      };
    }
    return { ok: true };
  };

  const planGate = gateCheck('plan-approval');
  if (!planGate.ok) return planGate;

  const contractGate = gateCheck('contract-approval');
  if (!contractGate.ok) return contractGate;

  if (run.flags?.architectural_impact) {
    const archGate = gateCheck('architecture-approval');
    if (!archGate.ok) return archGate;
  }

  return { ok: true };
}

/**
 * Full implementation permission — decisions, blockers, phase, gates, and recorded implement entry.
 */
export function isImplementationPermitted(run) {
  if (!run || run.status !== 'active') {
    return { ok: false, reason: 'No active workflow run.' };
  }

  if (run.current_phase !== 'implement') {
    return {
      ok: false,
      reason: `Implementation not permitted in "${run.current_phase}" phase. Resolve decisions and gates, then run eos complete-phase.`,
      phase: run.current_phase,
    };
  }

  const phaseGate = canEnterImplementPhase(run);
  if (!phaseGate.ok) return phaseGate;

  if (!run.implementation_entered_at) {
    return {
      ok: false,
      reason:
        'Implementation entry not recorded — advance to implement via `eos complete-phase` after all gates approve.',
    };
  }

  return { ok: true };
}

/**
 * Canonical shared authorization entry point for governed application mutation.
 * All adapters and hooks must delegate to this function.
 */
export function evaluateMutationAuthorization(params) {
  return authorizeApplicationMutation(params);
}

export function isGuardedWorkflowActive(run, eosInitialized = true) {
  return Boolean(eosInitialized && run && run.status === 'active' && !isImplementationPermitted(run).ok);
}

export function isReadOnlyShellCommand(command = '') {
  const split = splitShellCommand(command);
  if (!split.ok || split.segments.length !== 1 || /\$\(|`|<<|(?:^|\s)(?:>|<)(?:\s|$)/.test(command)) return false;
  if (/\bgit\b[^\n]*\s--output(?:=|\s+)/.test(command)) return false;
  return READ_ONLY_SHELL_COMMANDS.some((pattern) => pattern.test(command));
}

export function isShellInterpreterMutation(command = '') {
  return INTERPRETER_MUTATION_PATTERNS.some((pattern) => pattern.test(command));
}

/** @deprecated Use classifyShellCommand — never synthesizes fake mutation paths. */
export function extractInterpreterMutationPaths(command = '') {
  if (!command || !isShellInterpreterMutation(command)) return [];
  return ['__SHELL_INTERPRETER_UNRESOLVED__'];
}

/**
 * Authoritative governed-application mutation authorization (fail-closed when EOS is initialized).
 */
export function authorizeApplicationMutation({ root, filePath, run, eosInitialized = isEosInitialized(root) }) {
  const pathValidation = validateMutationTargetPath(filePath, root);
  if (!pathValidation.ok) {
    return { ok: false, scope: GUARD_SCOPE.APPLICATION, reason: pathValidation.reason };
  }

  if (filePath && isEosPathTraversalEscape(filePath, root)) {
    return {
      ok: false,
      scope: GUARD_SCOPE.APPLICATION,
      reason: 'Engineering OS path resolves outside .engineering-os — denied fail-closed.',
    };
  }

  if (filePath && isProtectedEngineeringOsControlPath(filePath, root)) {
    return {
      ok: false,
      scope: GUARD_SCOPE.ENGINEERING_OS,
      reason:
        'Engineering OS control-plane files are engine-managed and cannot be mutated directly.',
    };
  }

  if (filePath && isEngineeringOsPath(filePath, root)) {
    return { ok: true, scope: GUARD_SCOPE.ENGINEERING_OS, reason: 'Engineering OS artifact path.' };
  }

  if (!eosInitialized) {
    return { ok: true, scope: GUARD_SCOPE.INACTIVE, reason: 'Engineering OS not initialized — guard inactive.' };
  }

  if (!run || run.status !== 'active') {
    return {
      ok: false,
      scope: GUARD_SCOPE.APPLICATION,
      reason:
        'No active governed workflow run. Start the appropriate EOS workflow (e.g. `eos feature`) before modifying application code.',
    };
  }

  const permission = isImplementationPermitted(run);
  if (!permission.ok) {
    return {
      ok: false,
      scope: GUARD_SCOPE.APPLICATION,
      reason: permission.reason,
      phase: permission.phase || run.current_phase,
      pending_decisions: getPendingDecisions(run).map((d) => d.id),
    };
  }

  return { ok: true, scope: GUARD_SCOPE.APPLICATION, reason: 'Implementation permitted.' };
}

/** @deprecated Use authorizeApplicationMutation */
export function isMutationPermitted({ run, root, filePath, eosInitialized = isEosInitialized(root) }) {
  return authorizeApplicationMutation({ root, filePath, run, eosInitialized });
}

export function buildGuardManifest(run) {
  const permission = run ? isImplementationPermitted(run) : { ok: false, reason: 'No active run.' };
  const pendingDecisions = run ? getPendingDecisions(run) : [];
  const pendingGates = [];

  if (run?.gates) {
    for (const [id, gate] of Object.entries(run.gates)) {
      if (gate?.status === 'pending') pendingGates.push(id);
    }
  }

  return {
    implementation_permitted: permission.ok,
    reason: permission.reason || null,
    phase: run?.current_phase || null,
    run_id: run?.id || null,
    blocked: Boolean(run?.blocked) || pendingDecisions.length > 0 || (run?.orchestration?.blockers?.length > 0),
    pending_decisions: pendingDecisions.map((d) => ({
      id: d.id,
      category: d.category,
      question: d.question,
      options: d.options.map((o) => ({ id: o.id, label: o.label })),
    })),
    pending_gates: pendingGates,
    allowed_write_scope: ['.engineering-os/** except engine-managed control-plane files'],
    protected_write_paths: [
      '.engineering-os/state.json',
      '.engineering-os/test-setup-staging/<run-id>/manifest.json',
    ],
    application_mutation_permitted: permission.ok,
  };
}

export function extractMutationPathsFromToolInput(toolName, toolInput = {}) {
  if (!isFileMutationTool(toolName)) return [];

  const paths = [];
  if (typeof toolInput.path === 'string') paths.push(toolInput.path);
  if (typeof toolInput.file_path === 'string') paths.push(toolInput.file_path);
  if (typeof toolInput.target_file === 'string') paths.push(toolInput.target_file);
  if (typeof toolInput.target_notebook === 'string') paths.push(toolInput.target_notebook);
  if (toolName === 'ApplyPatch') {
    const patchText = toolInput.patch || toolInput.input || toolInput.content;
    if (typeof patchText === 'string') {
      for (const match of patchText.matchAll(/^\*\*\* (?:Add|Update|Delete) File:\s+(.+)$/gm)) {
        paths.push(match[1].trim());
      }
    }
  }

  return [...new Set(paths)];
}

export function extractShellMutationPaths(command = '') {
  if (!command || typeof command !== 'string') return [];

  const paths = new Set();
  for (const pattern of SHELL_MUTATION_PATTERNS) {
    const re = new RegExp(pattern.source, pattern.flags);
    let match;
    while ((match = re.exec(command)) !== null) {
      const candidate = match[1]?.replace(/^['"]|['"]$/g, '');
      if (candidate && !candidate.startsWith('/dev/')) paths.add(candidate);
    }
  }
  return [...paths];
}

export function extractMutationPathsFromShellCommand(command = '') {
  if (isShellInterpreterMutation(command)) return extractInterpreterMutationPaths(command);
  return extractShellMutationPaths(command);
}

function collectMcpPathCandidates(args = {}) {
  const resolved = [];
  let hasInvalidPathField = false;
  let hasAmbiguousTargets = false;

  function walk(value, key = '') {
    if (MCP_PATH_KEY_PATTERN.test(key)) {
      if (value == null) {
        hasInvalidPathField = true;
        return;
      }
      if (typeof value === 'string') {
        if (!isValidMutationPath(value)) hasInvalidPathField = true;
        else resolved.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') {
            if (!isValidMutationPath(item)) hasInvalidPathField = true;
            else resolved.push(item);
          } else if (item != null) hasAmbiguousTargets = true;
        }
        return;
      }
      hasAmbiguousTargets = true;
      return;
    }

    if (typeof value === 'string') return;

    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      for (const item of value) walk(item, key);
      return;
    }
    for (const [k, v] of Object.entries(value)) walk(v, k);
  }

  walk(args);
  const uniquePaths = [...new Set(resolved)];
  if (uniquePaths.length > 1) hasAmbiguousTargets = true;

  return { paths: uniquePaths, hasInvalidPathField, hasAmbiguousTargets };
}

/**
 * Classify MCP operations as read-only, governed mutation (resolved path), or unresolved.
 * Unresolved mutations always fail closed — never synthesize placeholder paths.
 */
export function classifyMcpOperation(toolName = '', args = {}) {
  const name = String(toolName || '');
  const { paths, hasInvalidPathField, hasAmbiguousTargets } = collectMcpPathCandidates(args);

  if (hasInvalidPathField) {
    return {
      classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
      reason: 'MCP target path is missing, null, or invalid — denied fail-closed.',
    };
  }

  if (isWriteLikeMcpTool(name)) {
    if (!paths.length) {
      return {
        classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
        reason: 'Write-like MCP operation without resolvable target path — denied fail-closed.',
      };
    }
    if (hasAmbiguousTargets) {
      return {
        classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
        reason: 'MCP operation has multiple or ambiguous mutation targets — denied fail-closed.',
      };
    }
    return {
      classification: MUTATION_REQUEST_CLASS.GOVERNED,
      paths,
      reason: 'Resolved MCP mutation target.',
    };
  }

  if (isReadOnlyMcpTool(name)) {
    return {
      classification: MUTATION_REQUEST_CLASS.READ_ONLY,
      reason: 'Known read-only MCP operation.',
    };
  }

  return {
    classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
    reason: 'Unclassified MCP operation with unknown mutation semantics — denied fail-closed.',
  };
}

/** @deprecated Use classifyMcpOperation */
export function extractMutationPathsFromMcpInput(toolName = '', args = {}) {
  const classified = classifyMcpOperation(toolName, args);
  if (classified.classification === MUTATION_REQUEST_CLASS.READ_ONLY) return [];
  if (classified.classification === MUTATION_REQUEST_CLASS.UNRESOLVED) return ['__MCP_WRITE_UNRESOLVED__'];
  return classified.paths;
}

export function classifyShellCommand(command = '') {
  if (command == null || typeof command !== 'string' || !command.trim()) {
    return {
      classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
      reason: 'Missing or empty shell command — denied fail-closed.',
    };
  }

  if (/`|\$\(/.test(command)) {
    // Backticks routinely appear in ticket and Figma text ("update `DocumentUploader`"),
    // and a double-quoted argument still substitutes them, so denying is correct — but the
    // agent has to be told how to pass that text instead of concluding the guard is broken
    // and asking to disable it.
    const isIntake = /^\s*(?:cd\s[^\n]*&&\s*)?eos\s+feature\b/.test(command);
    return {
      classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
      reason: isIntake
        ? 'Shell command substitution has opaque execution semantics — denied fail-closed. The intake text contains a backtick or $( ), which the shell would execute. Write the text to a file under .engineering-os/ and pass `eos feature --context-file <path>` instead of inlining it.'
        : 'Shell command substitution has opaque execution semantics — denied fail-closed.',
    };
  }

  if (/<<-?\s*\S+/.test(command)) {
    return {
      classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
      reason: 'Shell heredoc has opaque execution semantics — denied fail-closed.',
    };
  }

  if (/^\s*(?:node\s+--test|npm\s+test|npm\s+run\s+test)\s*$/.test(command)) {
    return { classification: MUTATION_REQUEST_CLASS.READ_ONLY, reason: 'Exact known-safe test command.' };
  }

  const split = splitShellCommand(command);
  if (!split.ok) {
    return { classification: MUTATION_REQUEST_CLASS.UNRESOLVED, reason: split.reason };
  }

  const mutationPaths = new Set();
  for (const segment of split.segments) {
    if (
      !/^\s*(?:node\s+--test|npm\s+test|npm\s+run\s+test)\s*$/.test(segment) &&
      (isShellInterpreterMutation(segment) ||
        /\bfind\b[\s\S]*(?:-delete|-exec\s+(?:rm|sh|bash|zsh)\b)/.test(segment))
    ) {
      return {
        classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
        reason: 'Shell interpreter mutation — denied fail-closed.',
      };
    }
    const paths = extractShellMutationPaths(segment);
    if (paths.length) {
      if (!isRecognizedMutationSegment(segment)) {
        return {
          classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
          reason: 'Shell segment combines an unknown command with filesystem output — denied fail-closed.',
        };
      }
      for (const candidate of paths) mutationPaths.add(candidate);
      continue;
    }
    if (!isReadOnlyShellCommand(segment)) {
      return {
        classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
        reason: 'Unclassified shell command segment — denied fail-closed during governed workflow.',
      };
    }
  }

  if (mutationPaths.size) {
    return { classification: MUTATION_REQUEST_CLASS.GOVERNED, paths: [...mutationPaths] };
  }
  if (split.segments.length && split.segments.every((segment) => isReadOnlyShellCommand(segment))) {
    return { classification: MUTATION_REQUEST_CLASS.READ_ONLY, reason: 'Read-only shell command.' };
  }

  return {
    classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
    reason: 'Unclassified shell command — denied fail-closed during governed workflow.',
  };
}

function splitShellCommand(command) {
  const segments = [];
  let current = '';
  let quote = null;
  let escaped = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === '\\' && quote !== "'") {
      current += char;
      escaped = true;
      continue;
    }
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    const two = command.slice(index, index + 2);
    if (two === '&&' || two === '||') {
      if (!current.trim()) return { ok: false, reason: 'Malformed compound shell command — denied fail-closed.' };
      segments.push(current.trim());
      current = '';
      index++;
      continue;
    }
    if (char === ';' || char === '|') {
      if (!current.trim()) return { ok: false, reason: 'Malformed compound shell command — denied fail-closed.' };
      segments.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (quote || escaped || !current.trim()) {
    return { ok: false, reason: 'Malformed or ambiguous shell command — denied fail-closed.' };
  }
  segments.push(current.trim());
  return { ok: true, segments };
}

function isRecognizedMutationSegment(command) {
  if (/(?:^|\s)(?:>|>>)\s*/.test(command)) {
    const producer = command.replace(/(?:^|\s)(?:>|>>)[\s\S]*$/, '').trim();
    return READ_ONLY_SHELL_COMMANDS.some((pattern) => pattern.test(producer));
  }
  if (/^\s*git\s+(?:status|log|diff|show)\b[^\n]*\s--output(?:=|\s+)/.test(command)) return true;
  return /^\s*(?:tee|sed\s+-i\S*|rm\b|mv\b|cp\b|touch\b)/.test(command);
}

export function buildHookDenyResponse(reason, details = {}) {
  return {
    permission: 'deny',
    user_message: reason,
    agent_message: `Engineering OS mutation guard: ${reason} Allowed write scope during planning: .engineering-os/** only. Resolve workflow decisions and gates, approve plan, then run eos complete-phase.`,
    ...details,
  };
}

export function buildHookAllowResponse() {
  return { permission: 'allow' };
}

function denyUnresolvedMutation(reason, extra = {}) {
  return {
    ok: false,
    reason,
    failClosed: true,
    classification: MUTATION_REQUEST_CLASS.UNRESOLVED,
    ...extra,
  };
}

function authorizeGovernedPaths({ paths, root, run, eosInitialized }) {
  for (const filePath of paths) {
    const auth = authorizeApplicationMutation({ root, filePath, run, eosInitialized });
    if (!auth.ok) return { ...auth, path: filePath };
  }
  return { ok: true, reason: 'Mutation authorized.', paths };
}

/**
 * Unified fail-closed hook evaluation for tool, shell, and MCP mutation requests.
 */
export function evaluateGuardHookRequest({
  payload = {},
  root,
  run,
  eosInitialized = isEosInitialized(root),
  hookKind = 'tool',
}) {
  if (!eosInitialized) {
    return { ok: true, reason: 'Engineering OS not initialized — guard inactive.', scope: GUARD_SCOPE.INACTIVE };
  }

  if (hookKind === 'shell') {
    const command = payload.command || payload.tool_input?.command || '';
    const classified = classifyShellCommand(command);

    if (classified.classification === MUTATION_REQUEST_CLASS.UNRESOLVED) {
      return denyUnresolvedMutation(classified.reason);
    }
    if (classified.classification === MUTATION_REQUEST_CLASS.GOVERNED) {
      return authorizeGovernedPaths({ paths: classified.paths, root, run, eosInitialized });
    }
    return { ok: true, reason: classified.reason || 'Read-only shell command.' };
  }

  if (hookKind === 'mcp') {
    const toolName = payload.tool_name || payload.name || payload.server || '';
    const args = payload.arguments || payload.tool_input || payload.input || {};
    const classified = classifyMcpOperation(toolName, args);

    if (classified.classification === MUTATION_REQUEST_CLASS.READ_ONLY) {
      return { ok: true, reason: classified.reason || 'Read-only MCP call.' };
    }
    if (classified.classification === MUTATION_REQUEST_CLASS.UNRESOLVED) {
      return denyUnresolvedMutation(classified.reason);
    }
    return authorizeGovernedPaths({ paths: classified.paths, root, run, eosInitialized });
  }

  const toolName = payload.tool_name || payload.tool || '';
  if (!toolName) {
    return denyUnresolvedMutation('Guard hook payload is missing a tool name — denied fail-closed.');
  }
  if (isShellTool(toolName)) {
    const command = payload.tool_input?.command || payload.input?.command || '';
    const classified = classifyShellCommand(command);

    if (classified.classification === MUTATION_REQUEST_CLASS.UNRESOLVED) {
      return denyUnresolvedMutation(classified.reason);
    }
    if (classified.classification === MUTATION_REQUEST_CLASS.GOVERNED) {
      return authorizeGovernedPaths({ paths: classified.paths, root, run, eosInitialized });
    }
    return { ok: true, reason: classified.reason || 'Read-only shell tool invocation.' };
  }

  if (DYNAMIC_TOOL_NAMES.has(toolName)) {
    const dynamicInput = payload.tool_input || payload.input || {};
    const dynamicName = dynamicInput.toolName || dynamicInput.tool_name || dynamicInput.name || '';
    const dynamicArgs = dynamicInput.arguments || dynamicInput.args || {};
    const classified = classifyMcpOperation(dynamicName, dynamicArgs);
    if (classified.classification === MUTATION_REQUEST_CLASS.READ_ONLY) {
      return { ok: true, reason: classified.reason };
    }
    if (classified.classification === MUTATION_REQUEST_CLASS.UNRESOLVED) {
      return denyUnresolvedMutation(classified.reason);
    }
    return authorizeGovernedPaths({ paths: classified.paths, root, run, eosInitialized });
  }

  if (!isFileMutationTool(toolName)) {
    if (KNOWN_NON_MUTATION_TOOLS.has(toolName)) {
      return { ok: true, reason: 'Known non-mutation tool.' };
    }
    const input = payload.tool_input || payload.input || {};
    const hasPath = input && typeof input === 'object' &&
      Object.keys(input).some((key) => MCP_PATH_KEY_PATTERN.test(key));
    if (hasPath || /write|edit|delete|patch|create|move|copy|mutation/i.test(toolName)) {
      return denyUnresolvedMutation(`Opaque local tool "${toolName}" may mutate files — denied fail-closed.`);
    }
    return { ok: true, reason: 'Non-mutation tool.' };
  }

  const toolInput = payload.tool_input || payload.input || {};
  const relevantPathKeys = ['path', 'file_path', 'target_file', 'target_notebook'];
  const suppliedPathValues = relevantPathKeys
    .filter((key) => Object.prototype.hasOwnProperty.call(toolInput, key))
    .map((key) => toolInput[key]);
  if (suppliedPathValues.some((value) => !isValidMutationPath(value))) {
    return denyUnresolvedMutation(`Mutation tool "${toolName}" exposed an invalid target path — denied fail-closed.`);
  }
  const paths = extractMutationPathsFromToolInput(toolName, toolInput);
  if (!paths.length) {
    return denyUnresolvedMutation(`Mutation tool "${toolName}" did not expose a target path — denied fail-closed.`);
  }

  return authorizeGovernedPaths({ paths, root, run, eosInitialized });
}
