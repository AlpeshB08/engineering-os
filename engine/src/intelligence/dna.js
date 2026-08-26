import fs from 'node:fs';
import path from 'node:path';
import { detectArchetype, detectCapabilities } from '../detect.js';
import { ensureDir, intelligenceDir } from '../paths.js';
import { today } from '../util.js';
import { scanRepository, summarizeInventory } from './scan.js';
import { fileExists } from '../paths.js';

export function dnaJsonPath(root) {
  return path.join(intelligenceDir(root), 'project-dna.json');
}

export function dnaMdPath(root) {
  return path.join(intelligenceDir(root), 'project-dna.md');
}

export function loadDna(root) {
  const p = dnaJsonPath(root);
  if (!fileExists(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

export function renderDnaMarkdown(dna, capabilities, archetype) {
  const capRows = Object.entries(capabilities || {})
    .map(
      ([name, info]) =>
        `| ${name} | ${info.present ? 'yes' : 'no'} | ${(info.evidence || []).slice(0, 3).join(', ') || '—'} |`
    )
    .join('\n');

  return `# Project DNA

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** ${today()}
- **Root:** ${dna.root}
- **Archetype:** ${archetype || 'unknown'}
- **Files scanned:** ${dna.file_count}

## Summary

Reusable inventory and conventions detected via heuristic scan. Categories with zero matches are intentionally empty — do not invent assets.

## Counts

| Category | Count |
|----------|------:|
${Object.entries(dna.counts || {})
  .map(([k, v]) => `| ${k} | ${v} |`)
  .join('\n')}

## Conventions

${(dna.conventions || []).map((c) => `- ${c}`).join('\n') || '- (none detected)'}

## Inventory samples

${summarizeInventory(dna, 12) || '- (empty)'}

## Capability snapshot

| Capability | Present | Evidence |
|------------|---------|----------|
${capRows || '| — | — | — |'}

## Backend availability note

- Do not assume backend implementation from frontend API clients alone.
- Use Backend Dependency artifacts for contract gaps.

## How to refresh

\`\`\`bash
eos intel scan
eos intel graphs
\`\`\`
`;
}

export function writeReuseInventory(root, dna) {
  const dir = intelligenceDir(root);
  ensureDir(dir);
  const lines = [
    '# Reuse Inventory',
    '',
    '<!-- EOS_ARTIFACT_STATUS: complete -->',
    '',
    `- **Generated:** ${today()}`,
    '',
    'Prefer these existing assets before creating new ones.',
    '',
  ];
  for (const kind of [
    'design_system',
    'components',
    'hooks',
    'stores',
    'apis',
    'services',
    'utilities',
    'routes',
  ]) {
    const items = dna.inventory[kind] || [];
    lines.push(`## ${kind} (${items.length})`, '');
    if (!items.length) {
      lines.push('_None detected._', '');
      continue;
    }
    for (const item of items.slice(0, 200)) {
      lines.push(`- \`${item.path}\``);
    }
    if (items.length > 200) lines.push(`- … +${items.length - 200} more`);
    lines.push('');
  }
  const out = path.join(dir, 'reuse-inventory.md');
  fs.writeFileSync(out, lines.join('\n'));
  return out;
}

export function writeCapabilityMatrix(root, capabilities, archetype) {
  const dir = intelligenceDir(root);
  ensureDir(dir);
  const rows = Object.entries(capabilities || {})
    .map(
      ([name, info]) =>
        `| ${name} | ${info.present ? 'yes' : 'no'} | ${(info.evidence || []).join(', ') || '—'} |`
    )
    .join('\n');
  const content = `# Capability Matrix

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** ${today()}
- **Archetype:** ${archetype}

| Capability | Present | Evidence |
|------------|---------|----------|
${rows}

Absent capabilities must not be assumed. Skip related verification with evidence.
`;
  const out = path.join(dir, 'capability-matrix.md');
  fs.writeFileSync(out, content);
  return out;
}

export function writeArchitectureSummary(root, dna, archetype) {
  const dir = intelligenceDir(root);
  ensureDir(dir);
  const content = `# Architecture Summary

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** ${today()}
- **Archetype:** ${archetype}
- **Files scanned:** ${dna.file_count}

## Layout signals

${(dna.conventions || []).map((c) => `- ${c}`).join('\n') || '- unknown'}

## Layer inventory (counts)

${Object.entries(dna.counts || {})
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## Notes

- Summary is heuristic from path/import evidence.
- Refine during discovery; record durable decisions in ADRs / Decision Log.
`;
  const out = path.join(dir, 'architecture-summary.md');
  fs.writeFileSync(out, content);
  return out;
}

export function writeKnownRisks(root, dna, capabilities) {
  const dir = intelligenceDir(root);
  ensureDir(dir);
  const risks = [];
  if (!capabilities['unit-tests']?.present) {
    risks.push('No unit-test capability detected — verification must rely on manual checks.');
  }
  if (!capabilities['backend-source']?.present && capabilities['api-client-only']?.present) {
    risks.push('API client without backend source — never invent server contracts.');
  }
  if (!capabilities.ci?.present) {
    risks.push('No CI config detected — delivery verification is local-only unless added.');
  }
  if ((dna.counts?.other || 0) > (dna.counts?.components || 0) * 2 && dna.file_count > 20) {
    risks.push('Large unclassified file set — reuse inventory may be incomplete; refresh scan after layout changes.');
  }
  if (!risks.length) risks.push('No automatic risks flagged; continue evidence-based discovery.');

  const content = `# Known Risks

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** ${today()}

${risks.map((r) => `- ${r}`).join('\n')}
`;
  const out = path.join(dir, 'known-risks.md');
  fs.writeFileSync(out, content);
  return out;
}

export function writeStandardsSummary(root, frameworkHomePath) {
  const dir = intelligenceDir(root);
  ensureDir(dir);
  const standardsDir = path.join(frameworkHomePath, 'standards');
  let list = [];
  try {
    list = fs.readdirSync(standardsDir).filter((f) => f.endsWith('.md'));
  } catch {
    list = [];
  }
  const content = `# Engineering Standards Summary

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** ${today()}

Framework standards to apply on every workflow:

${list.map((f) => `- \`standards/${f}\``).join('\n') || '- (none found)'}

Core rules:

1. Discover before implementing
2. Reuse before creating
3. Never assume missing systems (especially backend)
4. Never modify architecture without approval
5. Verification is mandatory before delivery
`;
  const out = path.join(dir, 'standards-summary.md');
  fs.writeFileSync(out, content);
  return out;
}

export function runIntelScan(root, frameworkHomePath) {
  const capabilities = detectCapabilities(root);
  const archetype = detectArchetype(capabilities);
  const dna = scanRepository(root);
  dna.archetype = archetype;
  dna.capabilities = Object.fromEntries(
    Object.entries(capabilities).map(([k, v]) => [k, { present: v.present, evidence: v.evidence }])
  );

  const dir = intelligenceDir(root);
  ensureDir(dir);
  fs.writeFileSync(dnaJsonPath(root), JSON.stringify(dna, null, 2) + '\n');
  fs.writeFileSync(dnaMdPath(root), renderDnaMarkdown(dna, capabilities, archetype));

  const outputs = {
    dnaJson: dnaJsonPath(root),
    dnaMd: dnaMdPath(root),
    reuseInventory: writeReuseInventory(root, dna),
    capabilityMatrix: writeCapabilityMatrix(root, capabilities, archetype),
    architectureSummary: writeArchitectureSummary(root, dna, archetype),
    knownRisks: writeKnownRisks(root, dna, capabilities),
    standardsSummary: writeStandardsSummary(root, frameworkHomePath),
  };

  return { dna, capabilities, archetype, outputs };
}
