import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectArchetype, detectCapabilities, detectRunnableCommands } from './detect.js';

test('detects frontend react vite project', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      dependencies: { react: '19.0.0' },
      devDependencies: { vite: '6.0.0', eslint: '9.0.0' },
      scripts: { build: 'vite build' },
    })
  );
  fs.writeFileSync(path.join(dir, 'vite.config.ts'), 'export default {}');
  const caps = detectCapabilities(dir);
  assert.equal(caps.frontend.present, true);
  assert.equal(caps.lint.present, true);
  assert.equal(detectArchetype(caps), 'frontend');
});

test('detects monorepo', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ private: true, workspaces: ['packages/*'] }));
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  const caps = detectCapabilities(dir);
  assert.equal(caps.monorepo.present, true);
  assert.equal(detectArchetype(caps), 'monorepo');
});

test('detectRunnableCommands reads package scripts', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-'));
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      scripts: { lint: 'eslint .', test: 'vitest run', build: 'vite build' },
      devDependencies: { vitest: '1.0.0', eslint: '9.0.0' },
    })
  );
  const caps = detectCapabilities(dir);
  const cmds = detectRunnableCommands(dir, caps);
  assert.ok(cmds.some((c) => c.name === 'lint'));
  assert.ok(cmds.some((c) => c.name === 'unit tests'));
  assert.ok(cmds.some((c) => c.name === 'build'));
});
