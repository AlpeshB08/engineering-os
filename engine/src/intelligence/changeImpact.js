import path from 'node:path';
import { loadDna } from './dna.js';
import { loadAllGraphs } from './graphs.js';

function normalizeTarget(target) {
  return target.replace(/^\.\//, '').split(path.sep).join('/');
}

function matchesTarget(filePath, target) {
  const t = normalizeTarget(target);
  const f = filePath.split(path.sep).join('/');
  return f === t || f.endsWith('/' + t) || f.includes(t) || path.basename(f).startsWith(path.basename(t));
}

function reverseReachable(graphs, target) {
  const affected = new Set();
  for (const graph of Object.values(graphs)) {
    if (!graph?.edges) continue;
    // BFS reverse: who imports target
    const rev = new Map();
    for (const e of graph.edges) {
      if (!rev.has(e.to)) rev.set(e.to, []);
      rev.get(e.to).push(e.from);
    }
    const seeds = [...(graph.nodes || [])].filter((n) => matchesTarget(n, target));
    const queue = [...seeds];
    const seen = new Set(seeds);
    while (queue.length) {
      const cur = queue.shift();
      affected.add(cur);
      for (const parent of rev.get(cur) || []) {
        if (!seen.has(parent)) {
          seen.add(parent);
          queue.push(parent);
        }
      }
    }
  }
  return [...affected];
}

/**
 * Analyze impact of changing a file/component path.
 */
export function analyzeChangeImpact(root, targetPath) {
  const dna = loadDna(root);
  if (!dna) throw new Error('Project DNA missing. Run `eos intel scan` first.');
  const graphs = loadAllGraphs(root);
  const target = normalizeTarget(targetPath);

  const directKind = [];
  for (const [kind, items] of Object.entries(dna.inventory || {})) {
    for (const i of items) {
      if (matchesTarget(i.path, target)) directKind.push({ kind, path: i.path });
    }
  }

  const reachable = reverseReachable(graphs, target);

  const byKind = {
    components: [],
    routes: [],
    apis: [],
    stores: [],
    hooks: [],
    services: [],
    design_system: [],
    utilities: [],
    other: [],
  };

  const classify = (p) => {
    for (const [kind, items] of Object.entries(dna.inventory || {})) {
      if (items.some((i) => i.path === p)) return kind;
    }
    return 'other';
  };

  for (const p of reachable) {
    const k = classify(p);
    if (!byKind[k]) byKind[k] = [];
    byKind[k].push(p);
  }

  // Also include reverse_imports fuzzy matches from DNA
  for (const [imp, importers] of Object.entries(dna.reverse_imports || {})) {
    if (imp.includes(path.basename(target).replace(/\.(jsx?|tsx?)$/, ''))) {
      for (const impPath of importers) {
        const k = classify(impPath);
        if (!byKind[k].includes(impPath)) byKind[k].push(impPath);
      }
    }
  }

  return {
    target,
    matched_inventory: directKind,
    affected_files: reachable,
    affected_by_kind: byKind,
    regression_areas: [
      ...byKind.routes.slice(0, 20),
      ...byKind.components.slice(0, 20),
      ...byKind.apis.slice(0, 10),
      ...byKind.stores.slice(0, 10),
    ],
    notes: [
      'Impact is heuristic from import graphs + Project DNA.',
      'Confirm critically affected user journeys manually before delivery.',
    ],
  };
}

export function renderChangeImpactMarkdown(result) {
  const section = (title, items) =>
    `### ${title}\n\n${items.length ? items.map((i) => `- \`${i}\``).join('\n') : '- (none detected)'}\n`;

  return `# Change Impact Analysis

- **Target:** \`${result.target}\`
- **Matched inventory:** ${result.matched_inventory.map((m) => `${m.kind}:${m.path}`).join(', ') || '(none)'}

## Affected by kind

${Object.entries(result.affected_by_kind)
  .map(([k, v]) => section(k, v))
  .join('\n')}

## Suggested regression focus

${result.regression_areas.length ? result.regression_areas.map((p) => `- \`${p}\``).join('\n') : '- (none detected)'}

## Notes

${result.notes.map((n) => `- ${n}`).join('\n')}
`;
}
