/**
 * Optional dependency-tooling integration for regression blast radius.
 *
 * Engineering OS computes regression impact from its own project graph. That graph can
 * under-detect, which silently shrinks regression scope. When the consumer repository
 * already ships a real dependency analyser (dependency-cruiser, madge, or Nx), we can
 * use it as a *rescue* pass when the built-in analysis found nothing.
 *
 * Design rules:
 * - Detection only reads files; it never installs anything.
 * - The external tool is invoked with `--no-install` and a bounded timeout, and only when
 *   the built-in analysis produced no candidates, so the common path stays fast.
 * - Any failure falls back to the built-in result. The source used is always reported,
 *   so regression scope is never presented as authoritative when it was not computed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const SOURCE_DIR_CANDIDATES = ['src', 'app', 'lib', 'packages'];
const DEFAULT_TIMEOUT_MS = 60000;

function readPackageJson(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return null;
  }
}

function hasDependency(pkg, name) {
  if (!pkg) return false;
  return Boolean(pkg.dependencies?.[name] || pkg.devDependencies?.[name]);
}

function firstExisting(root, candidates) {
  for (const candidate of candidates) {
    const abs = path.join(root, candidate);
    try {
      if (fs.existsSync(abs) && fs.statSync(abs).isDirectory()) return candidate;
    } catch {
      /* ignore */
    }
  }
  return null;
}

/** Detect dependency analysers already present in the consumer repository. */
export function detectDependencyTooling(root) {
  const pkg = readPackageJson(root);
  const fileExists = (rel) => {
    try {
      return fs.existsSync(path.join(root, rel));
    } catch {
      return false;
    }
  };

  const dependencyCruiser = {
    present:
      hasDependency(pkg, 'dependency-cruiser') ||
      ['.dependency-cruiser.js', '.dependency-cruiser.cjs', '.dependency-cruiser.json']
        .some(fileExists),
    evidence: 'dependency-cruiser',
  };
  const madge = { present: hasDependency(pkg, 'madge'), evidence: 'madge' };
  const nx = { present: hasDependency(pkg, 'nx') || fileExists('nx.json'), evidence: 'nx' };

  return {
    dependencyCruiser,
    madge,
    nx,
    any: dependencyCruiser.present || madge.present || nx.present,
    sourceDir: firstExisting(root, SOURCE_DIR_CANDIDATES),
  };
}

function runJson(command, root, timeoutMs) {
  const out = execSync(command, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
    timeout: timeoutMs,
    maxBuffer: 32 * 1024 * 1024,
  });
  return JSON.parse(out);
}

function normalize(root, filePath) {
  const abs = path.resolve(root, filePath);
  return path.relative(root, abs).split(path.sep).join('/');
}

/**
 * Build a forward dependency map ({ file: [imported files] }) using whichever analyser
 * the repository already has. Returns null when unavailable or on any failure.
 */
export function buildForwardDependencyMap(root, tooling = detectDependencyTooling(root), options = {}) {
  const timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
  const dir = tooling.sourceDir;
  if (!dir) return null;

  if (tooling.dependencyCruiser?.present) {
    try {
      const json = runJson(
        `npx --no-install depcruise --no-config --output-type json ${JSON.stringify(dir)}`,
        root,
        timeoutMs
      );
      const map = {};
      for (const mod of json.modules || []) {
        if (!mod?.source) continue;
        map[normalize(root, mod.source)] = (mod.dependencies || [])
          .map((d) => d?.resolved)
          .filter(Boolean)
          .map((d) => normalize(root, d));
      }
      if (Object.keys(map).length) return { map, source: 'dependency-cruiser' };
    } catch {
      /* fall through to the next analyser */
    }
  }

  if (tooling.madge?.present) {
    try {
      const json = runJson(`npx --no-install madge --json ${JSON.stringify(dir)}`, root, timeoutMs);
      const map = {};
      for (const [file, deps] of Object.entries(json || {})) {
        map[normalize(root, path.join(dir, file))] = (deps || []).map((d) =>
          normalize(root, path.join(dir, d))
        );
      }
      if (Object.keys(map).length) return { map, source: 'madge' };
    } catch {
      /* fall through */
    }
  }

  return null;
}

/**
 * Reverse-dependency lookup: which files import (directly) any of `targetPaths`.
 * Returns [] when no analyser is available or nothing imports the targets.
 */
export function findReverseDependencies(root, targetPaths = [], options = {}) {
  const tooling = options.tooling || detectDependencyTooling(root);
  if (!tooling.any || !targetPaths.length) return { edges: [], source: null };

  const forward = options.forwardMap || buildForwardDependencyMap(root, tooling, options);
  if (!forward?.map) return { edges: [], source: null };

  const targets = new Set(targetPaths.map((p) => normalize(root, p)));
  const edges = [];
  for (const [consumerPath, deps] of Object.entries(forward.map)) {
    for (const dep of deps) {
      if (!targets.has(dep)) continue;
      if (consumerPath === dep) continue;
      edges.push({ changedPath: dep, consumerPath });
    }
  }
  return { edges, source: forward.source };
}
