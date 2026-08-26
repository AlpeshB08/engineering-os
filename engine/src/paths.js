import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function frameworkHome() {
  if (process.env.ENGINEERING_OS_HOME) {
    return path.resolve(process.env.ENGINEERING_OS_HOME);
  }
  // engine/src -> engine -> repo root
  return path.resolve(__dirname, '..', '..');
}

export function consumerRoot(cwd = process.cwd()) {
  return path.resolve(cwd);
}

export function eosDir(root = consumerRoot()) {
  return path.join(root, '.engineering-os');
}

export function statePath(root = consumerRoot()) {
  return path.join(eosDir(root), 'state.json');
}

export function intelligenceDir(root = consumerRoot()) {
  return path.join(eosDir(root), 'intelligence');
}

export function graphsDir(root = consumerRoot()) {
  return path.join(intelligenceDir(root), 'graphs');
}

export function contextDir(root = consumerRoot()) {
  return path.join(intelligenceDir(root), 'context');
}

export function workflowsDir(home = frameworkHome()) {
  return path.join(home, 'workflows');
}

export function phasesDir(home = frameworkHome()) {
  return path.join(home, 'phases');
}

export function templatesDir(home = frameworkHome()) {
  return path.join(home, 'templates');
}

export function knowledgeBaseDir(home = frameworkHome()) {
  return path.join(home, 'knowledge-base');
}

export function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

export function fileExists(p) {
  try {
    fs.accessSync(p, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
