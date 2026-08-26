import fs from 'node:fs';
import path from 'node:path';
import { loadDna } from './dna.js';

function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1);
}

function scoreCandidate(queryTokens, item) {
  const hay = tokenize(`${item.name} ${item.path} ${item.kind}`);
  let score = 0;
  const matched = [];
  for (const t of queryTokens) {
    if (hay.includes(t)) {
      score += 3;
      matched.push(t);
    } else if (hay.some((h) => h.includes(t) || t.includes(h))) {
      score += 1;
      matched.push(t);
    }
  }
  // Prefer design system / shared components
  if (item.kind === 'design_system') score += 2;
  if (item.kind === 'components') score += 1;
  if (item.kind === 'hooks' || item.kind === 'utilities') score += 1;
  return { score, matched };
}

/**
 * Rank reuse candidates for a query string.
 */
export function rankReuse(root, query, limit = 15) {
  const dna = loadDna(root);
  if (!dna) throw new Error('Project DNA missing. Run `eos intel scan` first.');
  const queryTokens = tokenize(query);
  if (!queryTokens.length) {
    return { query, candidates: [], recommendation: 'create', rationale: 'Empty query.' };
  }

  const all = [];
  for (const [kind, items] of Object.entries(dna.inventory || {})) {
    if (kind === 'other') continue;
    for (const item of items) {
      const { score, matched } = scoreCandidate(queryTokens, item);
      if (score <= 0) continue;
      all.push({
        path: item.path,
        name: item.name,
        kind,
        score,
        matched_tokens: matched,
        decision: score >= 4 ? 'reuse' : score >= 2 ? 'adapt' : 'consider',
        rationale:
          score >= 4
            ? `Strong name/path match (${matched.join(', ')}); reuse existing ${kind}.`
            : score >= 2
              ? `Partial match; consider adapting ${item.path} before creating new.`
              : `Weak match only; verify manually.`,
      });
    }
  }

  all.sort((a, b) => b.score - a.score);
  const candidates = all.slice(0, limit);
  const best = candidates[0];
  let recommendation = 'create';
  let rationale =
    'No suitable reuse candidates found in Project DNA. Creating new is acceptable only with justification in Implementation Plan.';
  if (best && best.score >= 4) {
    recommendation = 'reuse';
    rationale = `Reuse \`${best.path}\` (${best.kind}) — ${best.rationale}`;
  } else if (best && best.score >= 2) {
    recommendation = 'adapt';
    rationale = `Prefer adapting \`${best.path}\` over greenfield creation.`;
  }

  return { query, candidates, recommendation, rationale };
}

export function renderReuseAnalysisMarkdown(result, runId) {
  const rows = result.candidates
    .map(
      (c) =>
        `| ${c.score} | ${c.decision} | \`${c.path}\` | ${c.kind} | ${c.rationale} |`
    )
    .join('\n');

  return `# Reuse Analysis

<!-- EOS_ARTIFACT_STATUS: ready -->

- **Run ID:** ${runId || 'n/a'}
- **Query:** ${result.query}
- **Recommendation:** **${result.recommendation}**

## Decision summary

${result.rationale}

## Ranked candidates

| Score | Decision | Path | Kind | Rationale |
|------:|----------|------|------|-----------|
${rows || '| — | — | — | — | No candidates |'}

## New asset justification

${
  result.recommendation === 'create'
    ? '- State why existing inventory cannot satisfy the need.\n- List searched categories.'
    : '- Not applicable if reusing/adapting.\n- If still creating, explain rejection of top candidates.'
}

## Rules

- Prefer design-system / shared components over one-offs.
- Do not introduce parallel UI kits or state libraries.
- Explain every reuse decision above.
`;
}

export function writeReuseAnalysis(artifactsDir, result, runId) {
  const content = renderReuseAnalysisMarkdown(result, runId);
  const out = path.join(artifactsDir, 'reuse-analysis.md');
  fs.writeFileSync(out, content);
  return out;
}
