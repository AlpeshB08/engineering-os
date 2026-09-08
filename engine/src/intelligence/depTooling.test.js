import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectDependencyTooling,
  findReverseDependencies,
} from './depTooling.js';

function mkRepo(pkg = {}, files = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-deptool-'));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  return root;
}

test('detectDependencyTooling finds dependency-cruiser, madge and nx without installing anything', () => {
  const none = detectDependencyTooling(mkRepo({ name: 'x' }));
  assert.equal(none.any, false);

  const cruiser = detectDependencyTooling(mkRepo({ devDependencies: { 'dependency-cruiser': '16.0.0' } }));
  assert.equal(cruiser.dependencyCruiser.present, true);
  assert.equal(cruiser.any, true);

  const madge = detectDependencyTooling(mkRepo({ devDependencies: { madge: '8.0.0' } }));
  assert.equal(madge.madge.present, true);

  const nx = detectDependencyTooling(mkRepo({ name: 'x' }, { 'nx.json': '{}' }));
  assert.equal(nx.nx.present, true);
});

test('detectDependencyTooling picks a source directory when present', () => {
  const root = mkRepo({ name: 'x' });
  assert.equal(detectDependencyTooling(root).sourceDir, 'src');
});

test('findReverseDependencies returns nothing when no analyser is available', () => {
  const root = mkRepo({ name: 'x' });
  const result = findReverseDependencies(root, ['src/a.ts']);
  assert.deepEqual(result.edges, []);
  assert.equal(result.source, null);
});

test('findReverseDependencies inverts a forward dependency map to find consumers', () => {
  const root = mkRepo({ devDependencies: { madge: '8.0.0' } });
  const result = findReverseDependencies(root, ['src/components/Toggle.tsx'], {
    forwardMap: {
      source: 'madge',
      map: {
        'src/pages/Programs.tsx': ['src/components/Toggle.tsx', 'src/util.ts'],
        'src/components/FilterWrapper.tsx': ['src/components/Toggle.tsx'],
        'src/unrelated.ts': ['src/util.ts'],
      },
    },
  });
  const consumers = result.edges.map((e) => e.consumerPath).sort();
  assert.deepEqual(consumers, ['src/components/FilterWrapper.tsx', 'src/pages/Programs.tsx']);
  assert.equal(result.source, 'madge');
  // the changed path is echoed back on each edge
  assert.ok(result.edges.every((e) => e.changedPath === 'src/components/Toggle.tsx'));
});

test('findReverseDependencies never reports a file as its own consumer', () => {
  const root = mkRepo({ devDependencies: { madge: '8.0.0' } });
  const result = findReverseDependencies(root, ['src/a.ts'], {
    forwardMap: { source: 'madge', map: { 'src/a.ts': ['src/a.ts'] } },
  });
  assert.deepEqual(result.edges, []);
});

test('buildRegressionImpact survives when no analyser is installed and reports its source', async () => {
  const { buildRegressionImpact } = await import('./regressionImpact.js');
  const root = mkRepo({ name: 'x' });
  const impact = buildRegressionImpact(root, { hits: { components: ['src/a.tsx'] } });
  assert.ok(impact.analysis, 'analysis metadata is always present');
  assert.equal(typeof impact.analysis.status, 'string');
  // Falls back gracefully rather than throwing when tooling is absent.
  assert.ok(Array.isArray(impact.candidates));
});
