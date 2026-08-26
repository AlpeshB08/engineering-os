/**
 * Parse and normalize /feature intake (Jira, Figma, context).
 */

import { extractAcceptanceCriteria } from './intelligence/verificationMatrix.js';

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;
const JIRA_URL_RE = /(?:https?:\/\/)?[^/\s]+\/browse\/([A-Z][A-Z0-9]+-\d+)/i;
const FIGMA_URL_RE = /https?:\/\/(?:www\.)?figma\.com\/(?:design|file|board|slides)\/[^\s)]+/i;

export function parseJiraReference(input) {
  if (!input) return null;
  const trimmed = input.trim();
  const urlMatch = trimmed.match(JIRA_URL_RE);
  if (urlMatch) return { key: urlMatch[1].toUpperCase(), source: 'url', raw: trimmed };
  const keyMatch = trimmed.match(JIRA_KEY_RE);
  if (keyMatch) return { key: keyMatch[1].toUpperCase(), source: 'key', raw: trimmed };
  return null;
}

export function parseFigmaUrl(input) {
  if (!input) return null;
  const match = input.trim().match(FIGMA_URL_RE);
  return match ? { url: match[0], raw: input.trim() } : null;
}

export function parseFeatureIntake({ jira, figma, context }) {
  return {
    jira: parseJiraReference(jira),
    figma: parseFigmaUrl(figma),
    context: context?.trim() || '',
    parsed_at: new Date().toISOString(),
  };
}

export function renderIntakeFrontmatter(intake) {
  const lines = ['## Feature intake', '', `- **Parsed at:** ${intake.parsed_at}`];
  if (intake.jira) {
    lines.push(`- **Jira:** ${intake.jira.key} (${intake.jira.source})`);
    lines.push(`- **Jira reference:** ${intake.jira.raw}`);
  }
  if (intake.figma) {
    lines.push(`- **Figma:** ${intake.figma.url}`);
  }
  if (intake.context) {
    lines.push('', '### Additional context', '', intake.context);
  }
  return lines.join('\n');
}

export function applyIntakeToDiscoveryNotes(content, intake) {
  const block = renderIntakeFrontmatter(intake);
  if (content.includes('## Feature intake')) {
    return content.replace(/## Feature intake[\s\S]*?(?=\n## [^F]|\n## Request restatement|$)/, `${block}\n\n`);
  }
  const marker = '## Request restatement';
  if (content.includes(marker)) {
    return content.replace(marker, `${block}\n\n${marker}`);
  }
  return `${content.trim()}\n\n${block}\n`;
}

const INSUFFICIENT_TASK_RE =
  /^(fix|improve|update|change|refactor|tweak)\s+(the\s+)?\w+\s*$/i;

export function replaceMarkdownSection(content, heading, body) {
  const replacement = `${heading}\n\n${body.trim()}\n\n`;
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (content.includes(heading)) {
    return content.replace(new RegExp(`${escaped}[\\s\\S]*?(?=\\n## )`), replacement);
  }
  return content;
}

export function isContractSufficient(contractText = '') {
  return extractAcceptanceCriteria(contractText).length > 0;
}

export function splitAnswerIntoCriteria(text = '') {
  const lines = String(text)
    .split('\n')
    .map((line) => line.replace(/^\s*(?:\d+\.|[-*])\s+/, '').trim())
    .filter(Boolean);
  if (lines.length) return lines;
  const trimmed = String(text).trim();
  return trimmed ? [trimmed] : [];
}

export function deriveAcceptanceCriteriaFromContext(context = '') {
  const text = String(context || '').trim();
  if (!text) return [];
  const bullets = [];
  for (const line of text.split('\n')) {
    const match = line.match(/^\s*(?:\d+\.|[-*])\s+(.+)/);
    if (match?.[1]?.trim()) bullets.push(match[1].trim());
  }
  if (bullets.length) return bullets;
  if (text.length < 24 || INSUFFICIENT_TASK_RE.test(text)) return [];
  return [text];
}

export function seedContractFromTaskDescription(contractContent, context = '') {
  const text = String(context || '').trim();
  if (!text) return contractContent;
  let content = contractContent;
  const problem = content.split('## Problem')[1]?.split('\n## ')[0] || '';
  if (problem.trim().length < 10 || problem.includes('_(fill') || problem.includes('<!-- What problem')) {
    content = replaceMarkdownSection(content, '## Problem', text);
  }
  if (!extractAcceptanceCriteria(content).length) {
    const criteria = deriveAcceptanceCriteriaFromContext(text);
    if (criteria.length) {
      content = replaceMarkdownSection(
        content,
        '## Acceptance Criteria',
        criteria.map((item, index) => `${index + 1}. ${item}`).join('\n')
      );
    }
  }
  const scope = content.split('## Scope — In')[1]?.split('\n## ')[0] || '';
  if ((scope.trim() === '-' || scope.includes('<!--') || scope.trim().length < 3) && text) {
    content = replaceMarkdownSection(content, '## Scope — In', `- ${text.slice(0, 240)}`);
  }
  return content;
}

export function writeAcceptanceCriteria(contractContent, criteria = []) {
  const items = (criteria || []).map((item) => String(item).trim()).filter(Boolean);
  if (!items.length) return contractContent;
  return replaceMarkdownSection(
    contractContent,
    '## Acceptance Criteria',
    items.map((item, index) => `${index + 1}. ${item}`).join('\n')
  );
}

export function replaceAcceptanceCriterion(contractContent, acId, text) {
  const replacement = String(text || '').trim();
  if (!replacement) return contractContent;
  const items = extractAcceptanceCriteria(contractContent);
  const index = Number(String(acId).replace(/^AC/i, '')) - 1;
  if (!Number.isInteger(index) || index < 0) {
    return writeAcceptanceCriteria(contractContent, [...items, replacement]);
  }
  if (index >= items.length) {
    items.push(replacement);
  } else {
    items[index] = replacement;
  }
  return writeAcceptanceCriteria(contractContent, items);
}
