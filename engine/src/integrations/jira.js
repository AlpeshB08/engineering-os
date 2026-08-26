import fs from 'node:fs';
import path from 'node:path';
import { eosDir, ensureDir, fileExists } from '../paths.js';

const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/;

export function jiraConfigPath(root) {
  return path.join(eosDir(root), 'integrations', 'jira.json');
}

export function loadJiraConfig(root) {
  const p = jiraConfigPath(root);
  if (!fileExists(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function extractJiraKey(input) {
  if (!input) return null;
  const urlMatch = input.match(/\/browse\/([A-Z][A-Z0-9]+-\d+)/i);
  if (urlMatch) return urlMatch[1].toUpperCase();
  const keyMatch = input.match(JIRA_KEY_RE);
  return keyMatch ? keyMatch[1].toUpperCase() : null;
}

function authHeader(config) {
  if (config.email && config.apiToken) {
    const encoded = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64');
    return `Basic ${encoded}`;
  }
  if (config.pat) return `Bearer ${config.pat}`;
  return null;
}

export async function fetchJiraIssue(root, issueKeyOrUrl) {
  const config = loadJiraConfig(root);
  if (!config?.site) {
    return { ok: false, reason: 'no_config', key: extractJiraKey(issueKeyOrUrl) };
  }
  const key = extractJiraKey(issueKeyOrUrl) || issueKeyOrUrl;
  const auth = authHeader(config);
  if (!auth) return { ok: false, reason: 'no_auth', key };

  const base = config.site.replace(/\/$/, '');
  const url = `${base}/rest/api/3/issue/${key}?fields=summary,description,issuetype,labels,status,acceptanceCriteria,customfield_10000`;

  const res = await fetch(url, {
    headers: {
      Authorization: auth,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    return { ok: false, reason: `http_${res.status}`, key };
  }

  const data = await res.json();
  return { ok: true, key, issue: data, source: 'rest' };
}

function adfToText(node) {
  if (!node) return '';
  if (typeof node === 'string') return node;
  if (node.text) return node.text;
  if (Array.isArray(node.content)) {
    return node.content.map(adfToText).join(node.type === 'paragraph' ? '\n' : '');
  }
  return '';
}

function extractAcceptanceFromDescription(text) {
  const items = [];
  const acSection = text.split(/acceptance criteria/i)[1];
  if (acSection) {
    for (const line of acSection.split('\n')) {
      const m = line.match(/^\s*(?:\d+\.|[-*])\s+(.+)/);
      if (m) items.push(m[1].trim());
    }
  }
  return items;
}

export function normalizeJiraIssue(issuePayload, key, source = 'rest') {
  const fields = issuePayload?.fields || {};
  const description =
    typeof fields.description === 'string'
      ? fields.description
      : adfToText(fields.description);

  const acceptanceCriteria =
    fields.acceptanceCriteria ||
    fields.customfield_10000 ||
    extractAcceptanceFromDescription(description);

  const acList = Array.isArray(acceptanceCriteria)
    ? acceptanceCriteria.map(String)
    : typeof acceptanceCriteria === 'string'
      ? acceptanceCriteria.split('\n').filter((l) => l.trim())
      : extractAcceptanceFromDescription(description);

  const issueKey = key || issuePayload?.key;
  const now = new Date().toISOString();

  return {
    key: issueKey,
    summary: fields.summary || issuePayload?.summary || '',
    description: description.trim(),
    acceptance_criteria: acList.filter(Boolean),
    business_rules: issuePayload?.business_rules || [],
    metadata: {
      type: fields.issuetype?.name || issuePayload?.issue_type || 'Unknown',
      status: fields.status?.name || issuePayload?.status || 'Unknown',
      labels: fields.labels || issuePayload?.labels || [],
    },
    discovery: {
      source,
      complete: true,
      completed_at: now,
    },
    assumptions: issuePayload?.assumptions || [],
    open_questions: issuePayload?.open_questions || [],
    // legacy fields for render compatibility
    issue_type: fields.issuetype?.name || issuePayload?.issue_type || 'Unknown',
    status: fields.status?.name || issuePayload?.status || 'Unknown',
    labels: fields.labels || issuePayload?.labels || [],
    source: 'jira',
    normalized_at: now,
  };
}

export function normalizedJiraPath(root, key) {
  return path.join(eosDir(root), 'integrations', `jira-${key}.json`);
}

export function loadNormalizedJira(root, key) {
  const p = normalizedJiraPath(root, key);
  if (!fileExists(p)) return null;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

export function createPendingJiraStub(key) {
  return {
    key,
    summary: `(pending Jira discovery for ${key})`,
    description: '',
    acceptance_criteria: [],
    business_rules: [],
    metadata: { type: 'Unknown', status: 'Unknown', labels: [] },
    discovery: {
      source: 'pending',
      complete: false,
      completed_at: null,
    },
    assumptions: [],
    open_questions: [
      'Jira discovery incomplete — configure REST or use agent/MCP with `eos intel jira --from-json`.',
    ],
    issue_type: 'Unknown',
    status: 'Unknown',
    labels: [],
    source: 'jira',
    normalized_at: new Date().toISOString(),
  };
}

export function isJiraDiscoveryComplete(normalized) {
  if (!normalized?.discovery?.complete) return false;
  if (!normalized.summary && !normalized.description) return false;
  if (normalized.acceptance_criteria?.length) return true;
  if (normalized.open_questions?.length) return true;
  return false;
}

export function ingestNormalizedJira(root, run, normalized, meta = {}) {
  const validation = validateNormalizedJiraSchema(normalized);
  if (!validation.valid) {
    throw new Error(`Invalid normalized Jira schema: ${validation.errors.join(', ')}`);
  }
  writeNormalizedJiraJson(root, normalized);
  const block = renderJiraDiscoveryBlock(normalized, {
    source: meta.source || normalized.discovery?.source || 'unknown',
  });
  if (run?.artifacts_dir) {
    const discoveryPath = path.join(run.artifacts_dir, 'discovery-notes.md');
    if (fileExists(discoveryPath)) {
      let content = fs.readFileSync(discoveryPath, 'utf8');
      content = applyJiraToDiscoveryNotes(content, block);
      fs.writeFileSync(discoveryPath, content);
    }
    const contractPath = path.join(run.artifacts_dir, 'feature-contract.md');
    if (fileExists(contractPath)) {
      let contract = fs.readFileSync(contractPath, 'utf8');
      contract = seedContractFromJira(contract, normalized);
      fs.writeFileSync(contractPath, contract);
    }
  }
  return { complete: isJiraDiscoveryComplete(normalized), normalized };
}

export function ingestJiraFromJsonFile(root, run, jsonPath) {
  const raw = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
  const normalized = {
    ...raw,
    discovery: {
      source: 'agent',
      complete: true,
      completed_at: new Date().toISOString(),
      ...(raw.discovery || {}),
      complete: raw.discovery?.complete !== false,
    },
  };
  return ingestNormalizedJira(root, run, normalized, { source: 'agent' });
}

export function validateNormalizedJiraSchema(data) {
  const errors = [];
  if (!data.key) errors.push('missing key');
  if (!data.summary && !data.description) errors.push('missing summary and description');
  if (!Array.isArray(data.acceptance_criteria)) errors.push('acceptance_criteria must be array');
  if (!data.discovery || typeof data.discovery.complete !== 'boolean') {
    errors.push('discovery.complete required');
  }
  return { valid: errors.length === 0, errors };
}

export function renderJiraDiscoveryBlock(normalized, meta = {}) {
  const ac =
    normalized.acceptance_criteria?.length
      ? normalized.acceptance_criteria.map((a, i) => `${i + 1}. ${a}`).join('\n')
      : '_(none extracted — add manually or verify Jira fields)_';

  return `## Jira requirements (${normalized.key})

- **Summary:** ${normalized.summary || '—'}
- **Type:** ${normalized.issue_type}
- **Status:** ${normalized.status}
- **Labels:** ${(normalized.labels || []).join(', ') || '—'}
- **Source:** ${meta.source || normalized.source || 'unknown'}
- **Normalized at:** ${normalized.normalized_at}

### Description

${normalized.description || '_(empty)_'}

### Acceptance criteria (from Jira)

${ac}

### Assumptions

${normalized.assumptions?.length ? normalized.assumptions.map((a) => `- ${a}`).join('\n') : '- _(none)_'}

### Open questions

${normalized.open_questions?.length ? normalized.open_questions.map((q) => `- ${q}`).join('\n') : '- _(none)_'}
`;
}

export function applyJiraToDiscoveryNotes(content, block) {
  const marker = '## Jira requirements';
  if (content.includes(marker)) {
    return content.replace(/## Jira requirements[\s\S]*?(?=\n## [^J]|\n## Request restatement|\n## Repository findings|$)/, `${block.trim()}\n\n`);
  }
  const insertBefore = content.includes('## Request restatement')
    ? '## Request restatement'
    : '## Repository findings';
  return content.replace(insertBefore, `${block.trim()}\n\n${insertBefore}`);
}

export function seedContractFromJira(contractContent, normalized) {
  let content = contractContent;
  const problem = normalized.summary || normalized.description?.slice(0, 500) || '';
  if (problem && content.includes('## Problem')) {
    content = content.replace(
      /## Problem[\s\S]*?(?=\n## )/,
      `## Problem\n\n${problem}\n\n`
    );
  }
  if (normalized.acceptance_criteria?.length && content.includes('## Acceptance Criteria')) {
    const acLines = normalized.acceptance_criteria
      .map((a, i) => `${i + 1}. ${a}`)
      .join('\n');
    content = content.replace(
      /## Acceptance Criteria[\s\S]*?(?=\n## )/,
      `## Acceptance Criteria\n\n${acLines}\n\n`
    );
  }
  return content;
}

export function writeNormalizedJiraJson(root, normalized) {
  ensureDir(path.join(eosDir(root), 'integrations'));
  const out = normalizedJiraPath(root, normalized.key);
  fs.writeFileSync(out, JSON.stringify(normalized, null, 2));
  return out;
}

export const JIRA_SCHEMA_FIELDS = [
  'key',
  'summary',
  'description',
  'acceptance_criteria',
  'business_rules',
  'metadata',
  'discovery',
  'assumptions',
  'open_questions',
];
