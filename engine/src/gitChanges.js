import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileExists } from './paths.js';

function normalizeRepoPath(filePath = '') {
  return String(filePath).trim().replace(/^\.\//, '').split(path.sep).join('/');
}

function isImplementationPath(filePath) {
  const normalized = normalizeRepoPath(filePath);
  return Boolean(normalized) && normalized !== '.engineering-os' && !normalized.startsWith('.engineering-os/');
}

function runGit(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  }).trim();
}

function parseGitPathList(output = '') {
  return output
    .split('\n')
    .map(normalizeRepoPath)
    .filter(isImplementationPath);
}

function listUntrackedFiles(root) {
  try {
    const out = runGit(root, ['ls-files', '--others', '--exclude-standard']);
    return parseGitPathList(out);
  } catch {
    return [];
  }
}

/**
 * Tracked paths that differ from baseline through HEAD commits and/or the index/worktree.
 */
function listTrackedChangesSinceBaseline(root, baseline) {
  try {
    const out = runGit(root, ['diff', '--name-only', baseline]);
    return parseGitPathList(out);
  } catch {
    return [];
  }
}

function collectImplementationChangeFiles(root, baseline) {
  const files = new Set([
    ...listTrackedChangesSinceBaseline(root, baseline),
    ...listUntrackedFiles(root),
  ]);
  return [...files].sort();
}

export function isGitRepository(root) {
  return fileExists(path.join(root, '.git'));
}

export function resolveGitBaselineRef(root, run = {}) {
  if (run?.implementation_baseline_ref) return run.implementation_baseline_ref;
  if (!isGitRepository(root)) return null;
  try {
    for (const branch of ['main', 'master', 'develop']) {
      try {
        runGit(root, ['rev-parse', '--verify', branch]);
        return branch;
      } catch {
        // try next default branch
      }
    }
    return 'HEAD~1';
  } catch {
    return null;
  }
}

/**
 * Return normalized changed file paths from git diff against baseline.
 */
export function getChangedFilesFromGit(root, { baseRef = null, run = {} } = {}) {
  if (!isGitRepository(root)) {
    return { files: [], source: 'none', reason: 'not a git repository' };
  }
  const baseline = baseRef || resolveGitBaselineRef(root, run);
  if (!baseline) {
    return { files: [], source: 'git', reason: 'unable to resolve git baseline' };
  }
  try {
    const files = collectImplementationChangeFiles(root, baseline);
    return { files, source: 'git', baseline, reason: null };
  } catch (err) {
    return { files: [], source: 'git', baseline, reason: err.message || 'git diff failed' };
  }
}

export function captureImplementationBaseline(root, run = {}) {
  if (!isGitRepository(root)) return null;
  try {
    const sha = runGit(root, ['rev-parse', 'HEAD']);
    run.implementation_baseline_ref = sha;
    run.implementation_baseline_captured_at = new Date().toISOString();
    return sha;
  } catch {
    return null;
  }
}

export function getImplementationChangedFiles(root, run = {}, overrides = {}) {
  if (overrides.changedFiles) {
    return {
      files: overrides.changedFiles.map(normalizeRepoPath).filter(isImplementationPath),
      source: 'override',
      baseline: overrides.baseline || null,
      reason: null,
    };
  }
  if (run?.implementation_baseline_ref && isGitRepository(root)) {
    try {
      const files = collectImplementationChangeFiles(root, run.implementation_baseline_ref);
      return {
        files,
        source: 'git',
        baseline: run.implementation_baseline_ref,
        reason: null,
      };
    } catch (err) {
      return { files: [], source: 'git', baseline: run.implementation_baseline_ref, reason: err.message };
    }
  }
  return getChangedFilesFromGit(root, { run });
}
