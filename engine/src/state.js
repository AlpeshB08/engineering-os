import fs from 'node:fs';
import { eosDir, ensureDir, fileExists, statePath } from './paths.js';
import { nowIso } from './util.js';

export function defaultState() {
  return {
    version: 1,
    initialized_at: nowIso(),
    framework_home: null,
    capabilities: {},
    archetype: 'unknown',
    feature_intake: null,
    completed_runs: [],
    last_completion: null,
    active_run: null,
  };
}

export function loadState(root) {
  const p = statePath(root);
  if (!fileExists(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function saveState(root, state) {
  ensureDir(eosDir(root));
  fs.writeFileSync(statePath(root), JSON.stringify(state, null, 2) + '\n');
}

export function requireState(root) {
  const state = loadState(root);
  if (!state) {
    throw new Error('Engineering OS not initialized. Run `eos init` first.');
  }
  return state;
}
