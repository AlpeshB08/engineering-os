import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, fileExists, graphsDir } from '../paths.js';
import { loadDna } from './dna.js';

function resolveImportToPath(fromFile, imp, allPaths) {
  if (imp.startsWith('@/')) {
    const rest = imp.slice(2);
    const candidates = [
      `src/${rest}`,
      `src/${rest}.ts`,
      `src/${rest}.tsx`,
      `src/${rest}.js`,
      `src/${rest}.jsx`,
      `src/${rest}/index.ts`,
      `src/${rest}/index.tsx`,
    ];
    return candidates.find((c) => allPaths.has(c)) || null;
  }
  if (!imp.startsWith('.')) return null;
  const dir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(dir, imp));
  const candidates = [
    joined,
    `${joined}.ts`,
    `${joined}.tsx`,
    `${joined}.js`,
    `${joined}.jsx`,
    `${joined}/index.ts`,
    `${joined}/index.tsx`,
    `${joined}/index.js`,
  ];
  return candidates.find((c) => allPaths.has(c)) || null;
}

function buildEdges(dna, filterFn) {
  const allPaths = new Set();
  for (const items of Object.values(dna.inventory || {})) {
    for (const i of items) allPaths.add(i.path);
  }
  // also include other files from import_index keys
  for (const f of Object.keys(dna.import_index || {})) allPaths.add(f);

  const nodes = new Set();
  const edges = [];
  for (const [from, imports] of Object.entries(dna.import_index || {})) {
    if (!filterFn(from, dna)) continue;
    for (const imp of imports) {
      const to = resolveImportToPath(from, imp, allPaths);
      if (!to) continue;
      if (!filterFn(to, dna) && !filterFn(from, dna)) continue;
      nodes.add(from);
      nodes.add(to);
      edges.push({ from, to });
    }
  }
  return { nodes: [...nodes], edges };
}

function kindOf(dna, filePath) {
  for (const [kind, items] of Object.entries(dna.inventory || {})) {
    if (items.some((i) => i.path === filePath)) return kind;
  }
  return 'other';
}

function toMermaid(name, graph) {
  const id = (p) =>
    'n_' +
    p
      .replace(/[^a-zA-Z0-9]/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 80);
  const lines = [`flowchart LR`, `  %% ${name}`];
  const seen = new Set();
  for (const n of graph.nodes.slice(0, 80)) {
    const nid = id(n);
    if (seen.has(nid)) continue;
    seen.add(nid);
    lines.push(`  ${nid}["${n}"]`);
  }
  for (const e of graph.edges.slice(0, 120)) {
    lines.push(`  ${id(e.from)} --> ${id(e.to)}`);
  }
  if (!graph.edges.length) lines.push(`  empty["(no edges detected)"]`);
  return lines.join('\n') + '\n';
}

function writeGraph(root, name, graph) {
  const dir = graphsDir(root);
  ensureDir(dir);
  const jsonPath = path.join(dir, `${name}.json`);
  const mmdPath = path.join(dir, `${name}.mmd`);
  fs.writeFileSync(jsonPath, JSON.stringify(graph, null, 2) + '\n');
  fs.writeFileSync(mmdPath, toMermaid(name, graph));
  return { jsonPath, mmdPath };
}

export function generateGraphs(root) {
  let dna = loadDna(root);
  if (!dna) {
    throw new Error('Project DNA missing. Run `eos intel scan` first.');
  }

  const shared = buildEdges(
    dna,
    (f, d) => ['components', 'design_system', 'hooks'].includes(kindOf(d, f))
  );
  const api = buildEdges(dna, (f, d) => ['apis', 'services'].includes(kindOf(d, f)));
  const routes = buildEdges(dna, (f, d) => ['routes', 'components', 'pages'].includes(kindOf(d, f)) || /\/pages\/|\/routes\//.test(f));
  const state = buildEdges(dna, (f, d) => ['stores', 'hooks', 'components'].includes(kindOf(d, f)));

  // Enrich graph metadata
  const wrap = (g, type) => ({
    type,
    generated_at: new Date().toISOString(),
    node_count: g.nodes.length,
    edge_count: g.edges.length,
    nodes: g.nodes,
    edges: g.edges,
  });

  return {
    'shared-components': writeGraph(root, 'shared-components', wrap(shared, 'shared-components')),
    api: writeGraph(root, 'api', wrap(api, 'api')),
    routes: writeGraph(root, 'routes', wrap(routes, 'routes')),
    state: writeGraph(root, 'state', wrap(state, 'state')),
  };
}

export function loadGraph(root, name) {
  const p = path.join(graphsDir(root), `${name}.json`);
  if (!fileExists(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function loadAllGraphs(root) {
  const names = ['shared-components', 'api', 'routes', 'state'];
  const out = {};
  for (const n of names) out[n] = loadGraph(root, n);
  return out;
}
