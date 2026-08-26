import fs from 'node:fs';
import path from 'node:path';
import { eosDir, ensureDir, fileExists } from '../paths.js';
import { artifactPath } from '../artifacts.js';
import { extractAcceptanceCriteria } from '../intelligence/verificationMatrix.js';
import { replaceMarkdownSection } from '../intake.js';

const FIGMA_URL_RE = /https?:\/\/(?:www\.)?figma\.com\/(?:design|file|board|slides)\/[^\s)]+/i;

export function parseFigmaUrl(input) {
  if (!input) return null;
  const match = String(input).trim().match(FIGMA_URL_RE);
  return match ? { url: match[0], raw: input.trim() } : null;
}

export function figmaDiscoveryPath(root) {
  return path.join(eosDir(root), 'integrations', 'figma-discovery.json');
}

export function loadFigmaDiscovery(root) {
  const p = figmaDiscoveryPath(root);
  if (!fileExists(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function writeFigmaDiscovery(root, normalized) {
  ensureDir(path.join(eosDir(root), 'integrations'));
  const out = figmaDiscoveryPath(root);
  fs.writeFileSync(out, JSON.stringify(normalized, null, 2));
  return out;
}

export function createPendingFigmaStub(url) {
  return {
    url,
    screens: [],
    interactions: [],
    states: { loading: [], empty: [], error: [] },
    components: [],
    responsive_notes: '',
    ui_requirements: [],
    discovery: {
      source: 'pending',
      complete: false,
      completed_at: null,
    },
    assumptions: [],
    open_questions: ['Figma design discovery required — use agent/MCP and `eos intel figma --from-json`.'],
  };
}

export function validateNormalizedFigmaSchema(data) {
  const errors = [];
  if (!data.url) errors.push('missing url');
  if (!data.discovery || typeof data.discovery.complete !== 'boolean') {
    errors.push('discovery.complete required');
  }
  return { valid: errors.length === 0, errors };
}

export function isFigmaDiscoveryComplete(normalized) {
  if (!normalized?.discovery?.complete) return false;
  const hasScreens = Array.isArray(normalized.screens) && normalized.screens.length > 0;
  const hasUiReqs =
    Array.isArray(normalized.ui_requirements) && normalized.ui_requirements.length > 0;
  const hasComponents = Array.isArray(normalized.components) && normalized.components.length > 0;
  return hasScreens || hasUiReqs || hasComponents;
}

export function renderFigmaDiscoveryBlock(normalized) {
  const screens =
    normalized.screens?.length
      ? normalized.screens.map((s) => `- ${s}`).join('\n')
      : '- _(none)_';
  const interactions =
    normalized.interactions?.length
      ? normalized.interactions.map((s) => `- ${s}`).join('\n')
      : '- _(none)_';
  const uiReqs =
    normalized.ui_requirements?.length
      ? normalized.ui_requirements.map((s) => `- ${s}`).join('\n')
      : '- _(none)_';
  const states = normalized.states || {};
  return `## Design requirements (Figma)

- **URL:** ${normalized.url}
- **Discovery source:** ${normalized.discovery?.source || 'unknown'}
- **Discovery complete:** ${normalized.discovery?.complete ? 'yes' : 'no'}
- **Completed at:** ${normalized.discovery?.completed_at || '—'}

### Screens

${screens}

### User interactions

${interactions}

### UI requirements

${uiReqs}

### States

- **Loading:** ${(states.loading || []).join('; ') || '—'}
- **Empty:** ${(states.empty || []).join('; ') || '—'}
- **Error:** ${(states.error || []).join('; ') || '—'}

### Components

${normalized.components?.length ? normalized.components.map((c) => `- ${c}`).join('\n') : '- _(none)_'}

### Responsive notes

${normalized.responsive_notes || '—'}
`;
}

export function applyFigmaToDiscoveryNotes(content, block) {
  const marker = '## Design requirements (Figma)';
  if (content.includes(marker)) {
    return content.replace(
      /## Design requirements \(Figma\)[\s\S]*?(?=\n## [^D]|\n## Request restatement|\n## Repository findings|\n## Jira requirements|$)/,
      `${block.trim()}\n\n`
    );
  }
  const insertBefore = content.includes('## Jira requirements')
    ? '## Request restatement'
    : content.includes('## Request restatement')
      ? '## Request restatement'
      : '## Repository findings';
  return content.replace(insertBefore, `${block.trim()}\n\n${insertBefore}`);
}

export function validateFigmaDiscoveryContent(discoveryMarkdown) {
  if (!discoveryMarkdown.includes('## Design requirements (Figma)')) {
    return { valid: false, reason: 'missing Figma section' };
  }
  const section =
    discoveryMarkdown.split('## Design requirements (Figma)')[1]?.split('\n## ')[0] || '';
  if (/Discovery complete:\*\* yes/i.test(section)) return { valid: true };
  if (section.includes('### Screens') && /Screens[\s\S]*-\s+[^\n_(]+/.test(section)) {
    return { valid: true };
  }
  if (/^\s*-\s+\*\*URL:\*\*/m.test(section) && section.trim().split('\n').length <= 4) {
    return { valid: false, reason: 'URL-only stub without design content' };
  }
  return { valid: false, reason: 'Figma discovery incomplete' };
}

export function deriveAcceptanceCriteriaFromFigma(normalized = {}) {
  const ui = (normalized.ui_requirements || []).map((item) => String(item).trim()).filter(Boolean);
  if (ui.length) return ui;
  return [];
}

export function seedContractFromFigma(contractContent, normalized = {}) {
  if (!normalized) return contractContent;
  let content = contractContent;
  const problemBits = [
    normalized.summary,
    (normalized.screens || []).length ? `Screens: ${(normalized.screens || []).join(', ')}` : '',
    (normalized.interactions || []).length
      ? `Interactions: ${(normalized.interactions || []).join(', ')}`
      : '',
  ].filter(Boolean);
  const problem = content.split('## Problem')[1]?.split('\n## ')[0] || '';
  if (problemBits.length && (problem.trim().length < 10 || problem.includes('_(fill') || problem.includes('<!-- What problem'))) {
    content = replaceMarkdownSection(content, '## Problem', problemBits.join('\n\n'));
  }
  if (!extractAcceptanceCriteria(content).length) {
    const criteria = deriveAcceptanceCriteriaFromFigma(normalized);
    if (criteria.length) {
      content = replaceMarkdownSection(
        content,
        '## Acceptance Criteria',
        criteria.map((item, index) => `${index + 1}. ${item}`).join('\n')
      );
    }
  }
  const scopeBits = [
    ...(normalized.screens || []).map((screen) => `Screen: ${screen}`),
    ...(normalized.components || []).map((component) => `Component: ${component}`),
  ];
  if (scopeBits.length) {
    const scope = content.split('## Scope — In')[1]?.split('\n## ')[0] || '';
    if (scope.trim() === '-' || scope.includes('<!--') || scope.trim().length < 3) {
      content = replaceMarkdownSection(
        content,
        '## Scope — In',
        scopeBits.map((item) => `- ${item}`).join('\n')
      );
    }
  }
  const uxNotes = [
    normalized.responsive_notes,
    (normalized.states?.loading || []).length ? `Loading: ${normalized.states.loading.join('; ')}` : '',
    (normalized.states?.empty || []).length ? `Empty: ${normalized.states.empty.join('; ')}` : '',
    (normalized.states?.error || []).length ? `Error: ${normalized.states.error.join('; ')}` : '',
  ].filter(Boolean);
  if (uxNotes.length) {
    content = replaceMarkdownSection(content, '## UX / API Notes', uxNotes.join('\n\n'));
  }
  return content;
}

export function ingestFigmaDiscovery(root, run, normalized) {
  if (!run?.artifacts_dir) throw new Error('No active run artifacts dir');
  const complete = isFigmaDiscoveryComplete({
    ...normalized,
    discovery: {
      ...(normalized.discovery || {}),
      complete: true,
    },
  });
  const toWrite = {
    ...normalized,
    discovery: {
      source: normalized.discovery?.source || 'agent',
      complete,
      completed_at: complete ? new Date().toISOString() : null,
    },
  };
  writeFigmaDiscovery(root, toWrite);
  const discoveryPath = artifactPath(run.artifacts_dir, 'discovery-notes');
  let content = fs.readFileSync(discoveryPath, 'utf8');
  content = applyFigmaToDiscoveryNotes(content, renderFigmaDiscoveryBlock(toWrite));
  fs.writeFileSync(discoveryPath, content);
  const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
  if (fileExists(contractPath)) {
    const contract = seedContractFromFigma(fs.readFileSync(contractPath, 'utf8'), toWrite);
    fs.writeFileSync(contractPath, contract);
  }
  return { path: discoveryPath, complete, normalized: toWrite };
}

export function ingestFigmaFromJsonFile(root, run, jsonPath, intakeUrl = null) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  } catch (err) {
    throw new Error(`Invalid Figma JSON: ${err.message}`);
  }
  if (intakeUrl && !raw.url) raw.url = intakeUrl;
  const schema = validateNormalizedFigmaSchema(raw);
  if (!schema.valid) {
    return { ok: false, complete: false, errors: schema.errors, normalized: raw };
  }
  const contentComplete = isFigmaDiscoveryComplete({
    ...raw,
    discovery: { ...raw.discovery, complete: true },
  });
  raw.discovery = {
    source: 'agent',
    complete: contentComplete,
    completed_at: contentComplete ? new Date().toISOString() : null,
  };
  if (!run?.artifacts_dir) {
    writeFigmaDiscovery(root, raw);
    return { ok: contentComplete, complete: contentComplete, normalized: raw, errors: contentComplete ? [] : ['insufficient design content'] };
  }
  const result = ingestFigmaDiscovery(root, run, raw);
  return {
    ok: result.complete,
    complete: result.complete,
    normalized: result.normalized,
    errors: result.complete ? [] : ['insufficient design content (screens, ui_requirements, or components required)'],
  };
}
