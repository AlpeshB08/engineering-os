import fs from 'node:fs';
import path from 'node:path';
import { fileExists } from '../paths.js';
import { loadDna } from './dna.js';
import { loadAllGraphs } from './graphs.js';
import { rankReuse } from './reuse.js';

function readContract(artifactsDir) {
  const p = path.join(artifactsDir, 'feature-contract.md');
  if (!fileExists(p)) return null;
  return fs.readFileSync(p, 'utf8');
}

function extractKeywords(contractText) {
  const text = contractText || '';
  const tokens = text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3);
  const stop = new Set([
    'this', 'that', 'with', 'from', 'have', 'will', 'should', 'must', 'status',
    'draft', 'ready', 'approval', 'feature', 'contract', 'users', 'goals', 'scope',
    'acceptance', 'criteria', 'notes', 'constraints', 'problem', 'description',
  ]);
  const freq = new Map();
  for (const t of tokens) {
    if (stop.has(t)) continue;
    freq.set(t, (freq.get(t) || 0) + 1);
  }
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([t]) => t);
}

function collectHits(dna, keywords) {
  const hits = {
    modules: [],
    components: [],
    routes: [],
    apis: [],
    stores: [],
    permissions: [],
    shared_components: [],
    regression_areas: [],
  };

  const match = (item) => {
    const hay = `${item.name} ${item.path}`.toLowerCase();
    return keywords.some((k) => hay.includes(k));
  };

  for (const item of dna.inventory.components || []) {
    if (match(item)) hits.components.push(item.path);
  }
  for (const item of dna.inventory.design_system || []) {
    if (match(item)) hits.shared_components.push(item.path);
  }
  for (const item of dna.inventory.routes || []) {
    if (match(item)) hits.routes.push(item.path);
  }
  for (const item of dna.inventory.apis || []) {
    if (match(item)) hits.apis.push(item.path);
  }
  for (const item of dna.inventory.services || []) {
    if (match(item)) hits.modules.push(item.path);
  }
  for (const item of dna.inventory.stores || []) {
    if (match(item)) hits.stores.push(item.path);
  }
  for (const item of [...(dna.inventory.other || []), ...(dna.inventory.utilities || [])]) {
    if (/permission|auth|role|guard|rbac/i.test(item.path) && match(item)) {
      hits.permissions.push(item.path);
    }
    if (match(item) && /module|feature|domain/i.test(item.path)) {
      hits.modules.push(item.path);
    }
  }

  hits.regression_areas = [
    ...new Set([...hits.routes, ...hits.components, ...hits.stores, ...hits.apis]),
  ].slice(0, 30);

  return hits;
}

export function generateFeatureImpact(root, artifactsDir, runId) {
  const dna = loadDna(root);
  if (!dna) throw new Error('Project DNA missing. Run `eos intel scan` first.');
  const contract = readContract(artifactsDir);
  if (!contract) throw new Error('feature-contract.md not found in active run artifacts.');

  const keywords = extractKeywords(contract);
  const hits = collectHits(dna, keywords);
  const reuse = rankReuse(root, keywords.join(' '), 8);
  const graphs = loadAllGraphs(root);
  const graphCoverage = Object.fromEntries(
    Object.entries(graphs).map(([k, g]) => [
      k,
      g ? { nodes: g.node_count, edges: g.edge_count } : { nodes: 0, edges: 0 },
    ])
  );

  return {
    run_id: runId,
    keywords,
    hits,
    reuse_recommendation: reuse.recommendation,
    reuse_rationale: reuse.rationale,
    top_reuse: reuse.candidates.slice(0, 5),
    graph_coverage: graphCoverage,
  };
}

export function renderFeatureImpactMarkdown(impact) {
  const list = (arr) => (arr.length ? arr.map((p) => `- \`${p}\``).join('\n') : '- (none detected — confirm manually)');

  return `# Feature Impact Analysis

<!-- EOS_ARTIFACT_STATUS: ready -->

- **Run ID:** ${impact.run_id || 'n/a'}
- **Keywords:** ${impact.keywords.join(', ') || '(none)'}

## Affected modules

${list(impact.hits.modules)}

## Components

${list(impact.hits.components)}

## Shared / design-system components

${list(impact.hits.shared_components)}

## Routes / screens

${list(impact.hits.routes)}

## APIs / services

${list(impact.hits.apis)}

## Stores / state

${list(impact.hits.stores)}

## Permissions / auth touchpoints

${list(impact.hits.permissions)}

## Regression areas

${list(impact.hits.regression_areas)}

## Reuse signal

- **Recommendation:** ${impact.reuse_recommendation}
- ${impact.reuse_rationale}

Top candidates:
${impact.top_reuse.map((c) => `- (${c.score}) \`${c.path}\` — ${c.decision}`).join('\n') || '- (none)'}

## Graph coverage used

${Object.entries(impact.graph_coverage)
  .map(([k, v]) => `- ${k}: ${v.nodes} nodes / ${v.edges} edges`)
  .join('\n')}

## Notes

- Generated from Feature Contract + Project DNA + dependency graphs.
- Empty sections mean no heuristic match — investigate during planning; do not invent impact.
`;
}

export function writeFeatureImpact(artifactsDir, impact) {
  const out = path.join(artifactsDir, 'feature-impact.md');
  fs.writeFileSync(out, renderFeatureImpactMarkdown(impact));
  return out;
}
