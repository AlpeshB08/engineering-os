/**
 * Artifact lifecycle classification and safe cleanup for consumer repositories.
 *
 * Automatic and manual cleanup both use executeCleanup(). Automatic cleanup adds
 * eligibility checks; it does not have a separate deletion implementation.
 */

import fs from 'node:fs';
import path from 'node:path';
import { eosDir, fileExists } from './paths.js';
import { loadState, saveState } from './state.js';
import { DELIVERY_STATUS } from './verificationStates.js';

export const ARTIFACT_CLASS = {
  RUNTIME: 'runtime',
  PERMANENT: 'permanent',
  AUDIT: 'audit',
  DELIVERABLE: 'deliverable',
};

/** The single existing feature artifact retained as an optional durable record. */
export const FEATURE_DURABLE_ARTIFACT_FILES = new Set(['delivery-preparation.md']);

/** Durable artifacts for workflows whose output is itself an audit/report. */
export const NON_FEATURE_DURABLE_ARTIFACT_FILES = new Set([
  'audit-report.md',
  'report.md',
  'delivery-preparation.md',
]);

/** Reserved run-scoped transient roots. */
export const RUNTIME_RELATIVE_PATTERNS = [
  'test-setup-staging',
  'tmp',
  'cache',
  'scratch',
];

const RUN_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const FINALIZED_STATUSES = new Set(['completed', 'aborted', 'failed']);
const CLEANUP_ALLOWED_ROOTS = new Set([
  'artifacts',
  'integrations',
  'intelligence',
  ...RUNTIME_RELATIVE_PATTERNS,
]);

export function classifyEosRelativePath(relativePath, { workflowId = null } = {}) {
  const normalized = relativePath.replace(/\\/g, '/').replace(/^\.engineering-os\/?/, '');

  if (normalized === 'state.json') {
    return { class: ARTIFACT_CLASS.RUNTIME, reason: 'Mutable local workflow state' };
  }
  if (RUNTIME_RELATIVE_PATTERNS.some((p) => normalized === p || normalized.startsWith(`${p}/`))) {
    return { class: ARTIFACT_CLASS.RUNTIME, reason: 'Transient run staging or scratch data' };
  }
  if (normalized.startsWith('artifacts/')) {
    const fileName = path.posix.basename(normalized);
    if (
      workflowId === 'feature-development' &&
      FEATURE_DURABLE_ARTIFACT_FILES.has(fileName)
    ) {
      return {
        class: ARTIFACT_CLASS.DELIVERABLE,
        reason: 'Optional final feature delivery record',
      };
    }
    if (
      workflowId &&
      workflowId !== 'feature-development' &&
      NON_FEATURE_DURABLE_ARTIFACT_FILES.has(fileName)
    ) {
      return {
        class: ARTIFACT_CLASS.DELIVERABLE,
        reason: 'Optional durable workflow report',
      };
    }
    return {
      class: ARTIFACT_CLASS.RUNTIME,
      reason: 'Run-scoped workflow artifact',
    };
  }
  if (normalized.startsWith('integrations/')) {
    if (normalized === 'integrations/jira.json') {
      return { class: ARTIFACT_CLASS.PERMANENT, reason: 'Project Jira configuration' };
    }
    return { class: ARTIFACT_CLASS.RUNTIME, reason: 'Feature discovery cache' };
  }
  if (normalized.startsWith('intelligence/context/')) {
    return { class: ARTIFACT_CLASS.RUNTIME, reason: 'Run/phase context package' };
  }
  if (
    normalized.startsWith('intelligence/') ||
    normalized.startsWith('knowledge-base/') ||
    normalized === 'README.md' ||
    normalized === 'recommended-gitignore.txt' ||
    normalized === 'repository-profile.md'
  ) {
    return { class: ARTIFACT_CLASS.PERMANENT, reason: 'Reusable project metadata/configuration' };
  }
  return { class: ARTIFACT_CLASS.PERMANENT, reason: 'Engineering OS project metadata' };
}

export function isValidRunId(runId) {
  return (
    typeof runId === 'string' &&
    RUN_ID_RE.test(runId) &&
    runId !== '.' &&
    runId !== '..' &&
    !runId.includes('..')
  );
}

function isPathInside(parent, candidate) {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function pathEntryExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch {
    return false;
  }
}

function assertNoSymlinkEscape(target, realEos) {
  if (!pathEntryExists(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isSymbolicLink()) {
    const resolved = fs.realpathSync(target);
    if (!isPathInside(realEos, resolved)) {
      throw new Error(`Refused cleanup symlink escape: ${target}`);
    }
    return;
  }
  if (!stat.isDirectory()) return;
  for (const entry of fs.readdirSync(target)) {
    assertNoSymlinkEscape(path.join(target, entry), realEos);
  }
}

function canonicalizeCleanupTarget(root, eosRoot, target) {
  const absoluteRoot = path.resolve(root);
  const absoluteEos = path.resolve(eosRoot);
  const absoluteTarget = path.resolve(target);
  if (!isPathInside(absoluteRoot, absoluteEos) || !isPathInside(absoluteEos, absoluteTarget)) {
    throw new Error(`Refused cleanup target outside .engineering-os: ${target}`);
  }
  const eosRelative = path.relative(absoluteEos, absoluteTarget);
  const firstSegment = eosRelative.split(path.sep)[0];
  if (!eosRelative || !CLEANUP_ALLOWED_ROOTS.has(firstSegment)) {
    throw new Error(`Refused cleanup target outside approved runtime roots: ${target}`);
  }
  if (
    firstSegment === 'intelligence' &&
    !eosRelative.startsWith(path.join('intelligence', 'context') + path.sep)
  ) {
    throw new Error(`Refused cleanup target outside intelligence/context: ${target}`);
  }

  const realRoot = fs.realpathSync(absoluteRoot);
  const realEos = pathEntryExists(absoluteEos) ? fs.realpathSync(absoluteEos) : absoluteEos;
  if (!isPathInside(realRoot, realEos)) {
    throw new Error(`Refused .engineering-os symlink outside repository: ${absoluteEos}`);
  }
  if (pathEntryExists(absoluteTarget)) {
    const realTarget = fs.realpathSync(absoluteTarget);
    if (!isPathInside(realEos, realTarget)) {
      throw new Error(`Refused cleanup symlink escape: ${absoluteTarget}`);
    }
    assertNoSymlinkEscape(absoluteTarget, realEos);
  }
  return absoluteTarget;
}

function listDirectoryNames(parent) {
  if (!fileExists(parent)) return [];
  return fs.readdirSync(parent, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map((entry) => entry.name);
}

function listRunIdsFromArtifacts(eosRoot) {
  return listDirectoryNames(path.join(eosRoot, 'artifacts'));
}

function runRecordMap(state, eosRoot) {
  const records = new Map();
  for (const run of state?.completed_runs || []) {
    if (isValidRunId(run?.id)) records.set(run.id, run);
  }
  if (isValidRunId(state?.active_run?.id)) records.set(state.active_run.id, state.active_run);
  for (const id of [
    ...listRunIdsFromArtifacts(eosRoot),
    ...listDirectoryNames(path.join(eosRoot, 'test-setup-staging')),
  ]) {
    if (!records.has(id)) records.set(id, { id, status: 'unknown', workflow_id: null });
  }
  return records;
}

function listImmediateEntries(directory) {
  if (!fileExists(directory)) return [];
  return fs.readdirSync(directory).map((name) => path.join(directory, name));
}

function addPlannedItem(list, root, eosRoot, target, artifactClass, reason) {
  if (!pathEntryExists(target)) return;
  list.push({
    path: canonicalizeCleanupTarget(root, eosRoot, target),
    class: artifactClass,
    reason,
  });
}

function intakeForRun(state, run) {
  if (state?.active_run?.id === run.id) return state.feature_intake || run.feature_intake || null;
  return run.feature_intake || null;
}

function planIntegrationCleanup(root, eosRoot, state, run, toRemove, toPreserve) {
  const intake = intakeForRun(state, run);
  if (intake?.jira?.key) {
    const target = path.join(eosRoot, 'integrations', `jira-${intake.jira.key}.json`);
    addPlannedItem(
      toRemove,
      root,
      eosRoot,
      target,
      ARTIFACT_CLASS.RUNTIME,
      `Jira discovery cache owned by ${run.id}`
    );
  }
  if (intake?.figma?.url) {
    const target = path.join(eosRoot, 'integrations', 'figma-discovery.json');
    if (fileExists(target)) {
      let belongsToRun = false;
      try {
        belongsToRun = JSON.parse(fs.readFileSync(target, 'utf8')).url === intake.figma.url;
      } catch {
        belongsToRun = false;
      }
      addPlannedItem(
        belongsToRun ? toRemove : toPreserve,
        root,
        eosRoot,
        target,
        belongsToRun ? ARTIFACT_CLASS.RUNTIME : ARTIFACT_CLASS.PERMANENT,
        belongsToRun
          ? `Figma discovery cache owned by ${run.id}`
          : 'Figma cache does not match the target run'
      );
    }
  }
}

function planContextCleanup(root, eosRoot, run, toRemove, toPreserve) {
  const contextRoot = path.join(eosRoot, 'intelligence', 'context');
  for (const target of listImmediateEntries(contextRoot)) {
    let belongsToRun = false;
    try {
      belongsToRun = fs.readFileSync(target, 'utf8').includes(`**Run:** ${run.id}`);
    } catch {
      belongsToRun = false;
    }
    addPlannedItem(
      belongsToRun ? toRemove : toPreserve,
      root,
      eosRoot,
      target,
      belongsToRun ? ARTIFACT_CLASS.RUNTIME : ARTIFACT_CLASS.PERMANENT,
      belongsToRun ? `Context package owned by ${run.id}` : 'Context package belongs to another run'
    );
  }
}

export function isAutomaticCleanupEligible(run) {
  if (!run || run.workflow_id !== 'feature-development' || run.status !== 'completed') {
    return { ok: false, reason: 'Automatic cleanup requires a completed feature-development run' };
  }
  const completed = new Set(run.completed_phases || []);
  for (const phase of ['implement', 'verify', 'review', 'deliver']) {
    if (!completed.has(phase)) {
      return { ok: false, reason: `Automatic cleanup requires completed ${phase} phase` };
    }
  }
  if (!run.implementation_entered_at) {
    return { ok: false, reason: 'Automatic cleanup requires authoritative implementation entry' };
  }
  if (
    run.verification_result?.run_id !== run.id ||
    run.verification_result?.status !== DELIVERY_STATUS.READY_FOR_REVIEW
  ) {
    return { ok: false, reason: 'Automatic cleanup requires current-run READY verification' };
  }
  const signoff = run.gates?.['delivery-signoff'];
  if (signoff?.status !== 'approved' || signoff.run_id !== run.id) {
    return { ok: false, reason: 'Automatic cleanup requires run-bound delivery sign-off' };
  }
  return { ok: true };
}

/**
 * Plan cleanup without mutating the repository.
 */
export function planCleanup(
  root,
  { runId = null, automatic = false, includeCompletedActiveRun = true } = {}
) {
  const eosRoot = eosDir(root);
  const state = loadState(root);
  const toRemove = [];
  const toPreserve = [];
  const notes = [];
  const stateChanges = [];

  if (runId !== null && !isValidRunId(runId)) {
    throw new Error(`Invalid run ID: ${String(runId)}`);
  }

  const records = runRecordMap(state, eosRoot);
  if (runId && !records.has(runId)) {
    notes.push(`Run ${runId} does not exist — nothing to clean`);
    return {
      toRemove,
      toPreserve,
      stateChanges,
      notes,
      eosRoot,
      eligible: true,
      targetRunIds: [],
    };
  }

  const targets = runId
    ? [records.get(runId)]
    : [...records.values()].filter((run) => FINALIZED_STATUSES.has(run.status));
  let eligible = true;

  for (const run of targets) {
    const artifactDir = path.join(eosRoot, 'artifacts', run.id);
    const staging = path.join(eosRoot, 'test-setup-staging', run.id);

    if (!FINALIZED_STATUSES.has(run.status)) {
      for (const target of [...listImmediateEntries(artifactDir), staging]) {
        addPlannedItem(
          toPreserve,
          root,
          eosRoot,
          target,
          ARTIFACT_CLASS.RUNTIME,
          `Run ${run.id} is not finalized`
        );
      }
      if (run.workflow_id === 'feature-development') {
        const runOwned = [];
        planIntegrationCleanup(root, eosRoot, state, run, runOwned, toPreserve);
        planContextCleanup(root, eosRoot, run, runOwned, toPreserve);
        for (const item of runOwned) {
          toPreserve.push({
            ...item,
            reason: `Run ${run.id} is not finalized`,
          });
        }
      }
      notes.push(`Run ${run.id} is not finalized — all run artifacts preserved`);
      continue;
    }

    if (automatic) {
      const check = isAutomaticCleanupEligible(run);
      if (!check.ok) {
        eligible = false;
        for (const target of [...listImmediateEntries(artifactDir), staging]) {
          addPlannedItem(
            toPreserve,
            root,
            eosRoot,
            target,
            ARTIFACT_CLASS.RUNTIME,
            check.reason
          );
        }
        notes.push(`${run.id}: ${check.reason}; automatic cleanup skipped`);
        continue;
      }
    }

    addPlannedItem(
      toRemove,
      root,
      eosRoot,
      staging,
      ARTIFACT_CLASS.RUNTIME,
      `Test capability staging for finalized run ${run.id}`
    );
    for (const name of RUNTIME_RELATIVE_PATTERNS.filter((name) => name !== 'test-setup-staging')) {
      addPlannedItem(
        toRemove,
        root,
        eosRoot,
        path.join(eosRoot, name, run.id),
        ARTIFACT_CLASS.RUNTIME,
        `Run-scoped transient data for ${run.id}`
      );
    }

    for (const target of listImmediateEntries(artifactDir)) {
      const classification = classifyEosRelativePath(path.relative(root, target), {
        workflowId: run.workflow_id,
      });
      const preserve =
        run.workflow_id !== 'feature-development' ||
        (run.status === 'completed' && classification.class === ARTIFACT_CLASS.DELIVERABLE);
      addPlannedItem(
        preserve ? toPreserve : toRemove,
        root,
        eosRoot,
        target,
        preserve ? classification.class : ARTIFACT_CLASS.RUNTIME,
        preserve
          ? classification.reason
          : `Temporary artifact for finalized ${run.workflow_id || 'unknown'} run ${run.id}`
      );
    }

    if (run.workflow_id === 'feature-development') {
      planIntegrationCleanup(root, eosRoot, state, run, toRemove, toPreserve);
      planContextCleanup(root, eosRoot, run, toRemove, toPreserve);
    }

    if (includeCompletedActiveRun && state?.active_run?.id === run.id) {
      stateChanges.push({
        type: 'archive_active_run',
        runId: run.id,
        reason: 'Archive finalized run after cleanup succeeds',
      });
    }
  }

  const unique = (items) => [...new Map(items.map((item) => [item.path, item])).values()];
  return {
    toRemove: unique(toRemove),
    toPreserve: unique(toPreserve),
    stateChanges,
    notes,
    eosRoot,
    eligible,
    targetRunIds: targets.map((run) => run.id),
  };
}

function compactCompletedRun(run, state) {
  const session = run.feature_session || {};
  const decisions = Object.values(run.workflow_decisions || {})
    .filter((decision) => decision?.status === 'answered')
    .map((decision) => ({
      id: decision.id,
      option: decision.selectedOption,
      result: decision.resultingStrategy || null,
    }));
  return {
    id: run.id,
    workflow_id: run.workflow_id,
    status: run.status,
    artifacts_dir: run.artifacts_dir,
    feature: {
      jira_key: state.feature_intake?.jira?.key || null,
      summary: state.feature_intake?.context || null,
    },
    feature_intake: state.feature_intake || null,
    final_status: run.verification_result?.status || null,
    verification_result: run.verification_result || null,
    decisions,
    completion: session.completion || state.last_completion || null,
    cleaned_at: new Date().toISOString(),
  };
}

function applySuccessfulStateChanges(root, changes) {
  if (!changes.length) return;
  const state = loadState(root);
  if (!state) return;
  for (const change of changes) {
    if (change.type !== 'archive_active_run' || state.active_run?.id !== change.runId) continue;
    state.completed_runs = state.completed_runs || [];
    const archived = compactCompletedRun(state.active_run, state);
    const index = state.completed_runs.findIndex((run) => run.id === change.runId);
    if (index >= 0) state.completed_runs[index] = { ...state.completed_runs[index], ...archived };
    else state.completed_runs.push(archived);
    if (archived.completion) state.last_completion = archived.completion;
    state.active_run = null;
    state.feature_intake = null;
  }
  saveState(root, state);
}

function recordCleanupFailure(root, runId, errors) {
  const state = loadState(root);
  if (state?.active_run?.id !== runId) return;
  state.active_run.cleanup = {
    status: 'failed',
    failed_at: new Date().toISOString(),
    errors,
  };
  saveState(root, state);
}

export function executeCleanup(
  root,
  {
    dryRun = false,
    runId = null,
    automatic = false,
    includeCompletedActiveRun = true,
  } = {}
) {
  const plan = planCleanup(root, {
    runId,
    automatic,
    includeCompletedActiveRun,
  });
  const removed = [];
  const errors = [];

  if (automatic && !plan.eligible) {
    errors.push('Automatic cleanup eligibility check failed; no artifacts were removed');
    if (runId) recordCleanupFailure(root, runId, errors);
    return { ...plan, removed, errors, dryRun };
  }

  for (const item of plan.toRemove) {
    if (dryRun) {
      removed.push({ path: item.path, dryRun: true });
      continue;
    }
    try {
      const safeTarget = canonicalizeCleanupTarget(root, plan.eosRoot, item.path);
      fs.rmSync(safeTarget, { recursive: true, force: true });
      removed.push({ path: item.path, dryRun: false });
    } catch (err) {
      errors.push(`${item.path}: ${err.message}`);
      break;
    }
  }

  if (!dryRun) {
    if (errors.length) {
      if (runId) recordCleanupFailure(root, runId, errors);
    } else {
      applySuccessfulStateChanges(root, plan.stateChanges);
    }
  }

  return { ...plan, removed, errors, dryRun };
}

export function renderManagedGitignoreBlock() {
  return `# Engineering OS runtime artifacts (managed by eos init)
# Local, per-developer workflow state — regenerable with \`eos init\` / \`eos detect\` / \`eos intel scan\`.
# Nothing here needs to be committed. Adapter config (.cursor/, .claude/, etc.) IS committed;
# this directory is not. Force-add a single file (e.g. a delivery record) only if you want to share it.
.engineering-os/
# End Engineering OS runtime artifacts`;
}

export function ensureConsumerGitignore(root) {
  const target = path.join(root, '.gitignore');
  const block = renderManagedGitignoreBlock();
  const existing = fileExists(target) ? fs.readFileSync(target, 'utf8') : '';
  const start = '# Engineering OS runtime artifacts (managed by eos init)';
  const end = '# End Engineering OS runtime artifacts';
  let next;
  if (existing.includes(start) && existing.includes(end)) {
    next = existing.replace(
      new RegExp(`${start.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?${end.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
      block
    );
  } else {
    next = `${existing.trimEnd()}${existing.trim() ? '\n\n' : ''}${block}\n`;
  }
  if (next !== existing) fs.writeFileSync(target, next);
  return { path: target, changed: next !== existing };
}

export function renderRecommendedGitignore() {
  return `# Engineering OS consumer Git guidance
#
# eos init installs the following managed block in the repository .gitignore.
# Runtime feature artifacts are generated and automatically cleaned only after
# READY verification, completed delivery, and run-bound delivery sign-off.

${renderManagedGitignoreBlock()}

# The whole .engineering-os/ directory is local, regenerable workflow state and is
# ignored by default — do not commit it. Commit your adapter config instead
# (.cursor/, .claude/, ENGINEERING_OS.md, etc.).
#
# If your team wants to share a specific durable file (e.g. a run's
# delivery-preparation.md completion record, or repository-profile.md), force-add
# just that file: \`git add -f .engineering-os/<path>\`.
`;
}
