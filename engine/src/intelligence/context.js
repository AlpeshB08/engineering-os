import fs from 'node:fs';
import path from 'node:path';
import { contextDir, ensureDir, eosDir, fileExists, phasesDir } from '../paths.js';
import { loadDna } from './dna.js';
import { summarizeInventory } from './scan.js';
import { searchKnowledge } from './knowledge.js';
import { renderOrchestrationManifest } from '../orchestration.js';

function checklistPathsForArchetype(frameworkHome, archetype) {
  const base = path.join(frameworkHome, 'checklists');
  const qa =
    archetype === 'backend'
      ? 'qa/backend.md'
      : archetype === 'fullstack' || archetype === 'monorepo'
        ? 'qa/fullstack.md'
        : 'qa/frontend.md';
  return [
    path.join(base, qa),
    path.join(base, 'qa/accessibility.md'),
    path.join(base, 'regression/ui-regression.md'),
    path.join(base, 'regression/api-regression.md'),
  ].filter((p) => fileExists(p));
}

function readSafe(p, max = 4000) {
  if (!fileExists(p)) return '';
  return fs.readFileSync(p, 'utf8').slice(0, max);
}

/**
 * Build a slim phase context pack — avoid full-repo dumps.
 */
export function buildContextPack({
  root,
  frameworkHome,
  state,
  workflow,
  phaseId,
  maxKbHits = 5,
}) {
  const run = state.active_run;
  const dna = loadDna(root);
  const profile = readSafe(path.join(eosDir(root), 'repository-profile.md'), 2500);
  const phasePath = path.join(phasesDir(frameworkHome), `${phaseId}.md`);
  const phaseDoc = readSafe(phasePath, 5000);

  let kbHits = [];
  try {
    kbHits = searchKnowledge(frameworkHome, root, `${workflow?.id || ''} ${phaseId}`, maxKbHits);
  } catch {
    kbHits = [];
  }

  const dnaSummary = dna
    ? `Files: ${dna.file_count}; Archetype: ${dna.archetype || state.archetype}\nCounts: ${JSON.stringify(dna.counts)}\nConventions: ${(dna.conventions || []).join(', ')}\n${summarizeInventory(dna, 5)}`
    : 'Project DNA missing — run `eos intel scan`.';

  const artifactList = [];
  if (run?.artifacts_dir && fileExists(run.artifacts_dir)) {
    for (const f of fs.readdirSync(run.artifacts_dir)) {
      if (f.endsWith('.md')) artifactList.push(f);
    }
  }

  const gates = run?.gates
    ? Object.entries(run.gates)
        .map(([id, g]) => `- ${id}: ${g.status}`)
        .join('\n')
    : '- (none)';

  const orchestration =
    workflow?.id === 'feature-development'
      ? renderOrchestrationManifest(phaseId)
      : '_N/A_';

  const checklists = checklistPathsForArchetype(frameworkHome, state.archetype || dna?.archetype || 'frontend');
  const checklistBlock = checklists.length
    ? checklists.map((p) => `- \`${p}\``).join('\n')
    : '- (none)';

  const content = `# Context Package — ${workflow?.id || 'n/a'} / ${phaseId}

> Load this pack instead of scanning the entire repository.

- **Generated:** ${new Date().toISOString()}
- **Run:** ${run?.id || 'n/a'}
- **Phase:** ${phaseId}

## Principles (excerpt)

- Discover before implementing; reuse before creating
- Never assume missing systems (especially backend)
- Never modify architecture without approval
- Verification is mandatory before delivery

## Current phase instructions

${phaseDoc || '_(phase markdown missing)_'}

## Repository profile (excerpt)

${profile || '_(missing — run eos detect)_'}

## Project DNA summary

${dnaSummary}

## Active run artifacts

${artifactList.length ? artifactList.map((a) => `- ${a}`).join('\n') : '- (none yet)'}

Artifacts dir: \`${run?.artifacts_dir || 'n/a'}\`

## Gates

${gates}

## Knowledge hits

${kbHits.length ? kbHits.map((h) => `- [${h.score}] ${h.type}: ${h.title} (\`${h.path}\`) — ${h.summary}`).join('\n') : '- (none)'}

## Orchestration manifest (feature workflow)

${orchestration}

## Regression / QA checklists (archetype: ${state.archetype || 'unknown'})

${checklistBlock}

## Intelligence commands for this phase

- \`eos feature\` — start feature with Jira/Figma intake
- \`eos feature orchestrate-plan\` — run plan-phase intelligence bundle
- \`eos intel jira\` — normalize Jira requirements (REST or MCP fallback)
- \`eos intel test-strategy\` — risk-based test strategy
- \`eos intel verify-matrix\` — fill verification matrix
- \`eos intel backend\` — scaffold backend dependency
- \`eos verify run\` / \`eos verify report\` — execute checks and final status
- \`eos intel scan\` — refresh DNA
- \`eos intel graphs\` — refresh graphs
- \`eos intel impact\` — feature impact (plan)
- \`eos intel reuse "<need>"\` — ranked reuse
- \`eos intel change-impact <path>\` — blast radius
- \`eos knowledge search "<query>"\`

## Do not

- Dump the entire repository into the prompt
- Invent backend contracts
- Skip human gates
`;

  ensureDir(contextDir(root));
  const fileName = `${workflow?.id || 'workflow'}-${phaseId}.md`;
  const out = path.join(contextDir(root), fileName);
  fs.writeFileSync(out, content);

  // Also write run-scoped pointer if active run
  if (run?.artifacts_dir) {
    ensureDir(run.artifacts_dir);
    const pointer = `# Context Package

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Phase:** ${phaseId}
- **Pack path:** \`${out}\`

Load the pack above for optimized prompt context.
`;
    fs.writeFileSync(path.join(run.artifacts_dir, 'context-package.md'), pointer);
  }

  return { path: out, content, bytes: content.length };
}
