/**
 * Inspect the current repository (and intake sources) before asking the user.
 * Reconciles backend support and architectural risk from authoritative files,
 * not stale planning artifacts.
 */

import fs from 'node:fs';
import path from 'node:path';
import { artifactPath } from '../artifacts.js';
import { detectCapabilities } from '../detect.js';
import { loadNormalizedJira } from '../integrations/jira.js';
import { loadFigmaDiscovery } from '../integrations/figma.js';

const IGNORE_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.engineering-os',
  'vendor',
  '__pycache__',
  '.venv',
  'venv',
  '.npm-cache',
  '.tmp',
]);

const SOURCE_EXT = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.java',
  '.kt',
  '.rb',
  '.php',
  '.cs',
  '.graphql',
  '.gql',
  '.prisma',
]);

const BACKEND_PATH = /(^|\/)(server|backend|api|apis|controllers|resolvers|services|modules|providers|dto|entities|prisma)(\/|$)/i;
const BACKEND_FILE = /(controller|resolver|service|module|entity|dto|schema|repository|handler)\./i;
const FRONTEND_PATH = /(^|\/)(components|pages|app|hooks|stores|ui|views|screens)(\/|$)/i;
const TEST_PATH = /(\.(test|spec)\.|\/(__tests__|tests|test|e2e|spec)s?\/)/i;

const ARCHITECTURE_RISK = [
  /new architectural boundary/i,
  /major data[- ]flow/i,
  /new (backend )?service\b/i,
  /new (domain )?module\b/i,
  /new permission(s)? model/i,
  /security model change/i,
  /cross-system (contract|api)/i,
  /contract redesign/i,
  /shared infrastructure change/i,
  /new auth(entication|orization) (layer|model|service)/i,
];

const LOCALIZED_ADDITIVE = [
  /additive prop/i,
  /optional prop/i,
  /existing (route|page|component|list|table)/i,
  /hidecompleted|hide completed/i,
  /small (ui|frontend|additive) change/i,
];

const TOKEN_STOP = new Set([
  'acceptanceCriteria',
  'featureContract',
  'backendAvailability',
  'openQuestions',
  'userFacing',
]);

export const BACKEND_SUPPORT = {
  SUPPORTED: 'supported',
  UNSUPPORTED: 'unsupported',
  UNAVAILABLE: 'unavailable',
};

function walkSourceFiles(root, files = [], base = root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const ent of entries) {
    if (IGNORE_DIRS.has(ent.name)) continue;
    if (ent.name.startsWith('.') && ent.name !== '.github') continue;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      walkSourceFiles(full, files, base);
      continue;
    }
    const ext = path.extname(ent.name);
    if (!SOURCE_EXT.has(ext)) continue;
    files.push(path.relative(base, full).split(path.sep).join('/'));
  }
  return files;
}

function classifyFile(relPath) {
  const lower = relPath.toLowerCase();
  if (TEST_PATH.test(lower)) return 'test';
  if (BACKEND_PATH.test(lower) || BACKEND_FILE.test(path.basename(lower))) return 'backend';
  if (FRONTEND_PATH.test(lower) || /\.(tsx|jsx)$/.test(lower)) return 'frontend';
  return 'other';
}

function toVariants(token) {
  const raw = String(token || '').trim();
  if (!raw) return [];
  const variants = new Set([raw, raw.toLowerCase()]);
  const camel = raw.replace(/[-_\s]+([a-zA-Z0-9])/g, (_, c) => c.toUpperCase());
  const snake = raw
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[-\s]+/g, '_')
    .toLowerCase();
  variants.add(camel);
  variants.add(camel.toLowerCase());
  variants.add(snake);
  return [...variants].filter(Boolean);
}

export function extractCapabilityTokens(text = '') {
  const tokens = new Set();
  const source = String(text || '');
  for (const match of source.matchAll(/\b([a-z][a-zA-Z0-9]{2,}[A-Z][a-zA-Z0-9]*)\b/g)) {
    if (!TOKEN_STOP.has(match[1])) tokens.add(match[1]);
  }
  for (const match of source.matchAll(/['"`]([a-zA-Z][a-zA-Z0-9_-]{2,})['"`]/g)) {
    tokens.add(match[1]);
  }
  if (/hide\s*completed/i.test(source)) tokens.add('hideCompleted');
  return [...tokens];
}

function fileMentions(content, variants) {
  const lower = content.toLowerCase();
  return variants.some((token) => lower.includes(String(token).toLowerCase()));
}

export function inspectRepositoryEvidence({
  root = '',
  contractText = '',
  impactText = '',
  impactSignals = {},
  intake = {},
  capabilities = null,
} = {}) {
  const caps = capabilities || (root && fs.existsSync(root) ? detectCapabilities(root) : {});
  const jira = intake?.jira?.key && root ? loadNormalizedJira(root, intake.jira.key) : null;
  const figma = intake?.figma?.url && root ? loadFigmaDiscovery(root) : null;
  const sourceText = [
    contractText,
    impactText,
    intake?.context || '',
    jira?.summary || '',
    jira?.description || '',
    ...(jira?.acceptance_criteria || []),
    figma?.summary || '',
  ].join('\n');

  const tokens = extractCapabilityTokens(sourceText);
  const files = root && fs.existsSync(root) ? walkSourceFiles(root) : [];
  const hits = { frontend: [], backend: [], tests: [], apis: [], components: [] };
  let backendFiles = 0;

  for (const rel of files) {
    const kind = classifyFile(rel);
    if (kind === 'backend') backendFiles += 1;
    let content = '';
    try {
      content = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    const variants = tokens.flatMap(toVariants);
    const mentions = variants.length ? fileMentions(content, variants) : false;
    if (!mentions && kind !== 'backend') continue;
    if (kind === 'backend' && mentions) hits.backend.push(rel);
    if (kind === 'frontend' && mentions) {
      hits.frontend.push(rel);
      if (/\/components\//i.test(rel)) hits.components.push(rel);
      if (/\/api\//i.test(rel) || /client|endpoint/i.test(rel)) hits.apis.push(rel);
    }
    if (kind === 'test' && mentions) hits.tests.push(rel);
    if (kind === 'other' && mentions && /\/api\//i.test(rel)) hits.apis.push(rel);
  }

  const backendInspectable = Boolean(caps['backend-source']?.present || backendFiles > 0);
  let backendSupport = BACKEND_SUPPORT.UNAVAILABLE;
  if (hits.backend.length) backendSupport = BACKEND_SUPPORT.SUPPORTED;
  else if (backendInspectable) backendSupport = BACKEND_SUPPORT.UNSUPPORTED;
  else backendSupport = BACKEND_SUPPORT.UNAVAILABLE;

  const architecture = assessArchitecturalRisk({
    contractText,
    impactText,
    impactSignals,
    sourceText,
  });

  return {
    inspected_at: new Date().toISOString(),
    tokens,
    files_inspected: files.length,
    backend: {
      support: backendSupport,
      inspectable: backendInspectable,
      hits: hits.backend,
    },
    frontend: {
      hits: hits.frontend,
      components: hits.components,
      apis: hits.apis,
    },
    tests: {
      related: hits.tests,
    },
    architecture,
    capabilities: {
      unit: Boolean(caps['unit-tests']?.present),
      e2e: Boolean(caps['e2e-tests']?.present),
      backend: Boolean(caps['backend-source']?.present),
    },
  };
}

export function assessArchitecturalRisk({
  contractText = '',
  impactText = '',
  impactSignals = {},
  sourceText = '',
} = {}) {
  const combined = `${contractText}\n${impactText}\n${sourceText}`;
  const stripped = combined.replace(/without (a |any )?new [^.\n]+/gi, '').replace(/no new [^.\n]+/gi, '');
  const localized = LOCALIZED_ADDITIVE.some((pattern) => pattern.test(combined));
  const genuine = ARCHITECTURE_RISK.filter((pattern) => pattern.test(stripped)).map((p) => p.source);
  const permissionModelChange =
    (impactSignals.permissions_touchpoints || 0) >= 2 &&
    /new (permission|role|rbac|security) model|permission model change/i.test(stripped);

  if (genuine.length || permissionModelChange) {
    return {
      reviewRequired: true,
      reason: genuine[0] || 'Permission/security model change',
      localized: false,
    };
  }

  return {
    reviewRequired: false,
    reason: localized
      ? 'Localized additive change; architecture review is not required.'
      : 'No new architectural boundary, service, data-flow, or security-model change was found.',
    localized,
  };
}

export function reconcileBackendContext(artifact = {}, evidence = {}) {
  const support = evidence?.backend?.support || BACKEND_SUPPORT.UNAVAILABLE;
  const availability =
    support === BACKEND_SUPPORT.SUPPORTED
      ? 'yes'
      : support === BACKEND_SUPPORT.UNSUPPORTED
        ? 'no'
        : 'unknown';
  return {
    needsBackend: Boolean(artifact.needsBackend || (evidence.tokens || []).length),
    availability,
    support,
    inspectable: Boolean(evidence?.backend?.inspectable),
    hits: evidence?.backend?.hits || [],
    text: artifact.text || '',
    path: artifact.path,
    staleArtifactAvailability: artifact.availability || null,
  };
}

export function persistEvidenceDiscovery(run, evidence) {
  if (!run) return evidence;
  run.evidence_discovery = evidence;
  if (!run.artifacts_dir || !evidence) return evidence;
  const backendPath = artifactPath(run.artifacts_dir, 'backend-dependency');
  if (!fs.existsSync(backendPath)) return evidence;
  let text = fs.readFileSync(backendPath, 'utf8');
  const availability =
    evidence.backend?.support === BACKEND_SUPPORT.SUPPORTED
      ? 'yes'
      : evidence.backend?.support === BACKEND_SUPPORT.UNSUPPORTED
        ? 'no'
        : 'unknown';
  if (/\*\*Backend availability:\*\*/i.test(text)) {
    text = text.replace(
      /\*\*Backend availability:\*\*\s*[^\n]*/i,
      `**Backend availability:** ${availability}`
    );
  }
  const section = [
    '## Repository evidence (reconciled)',
    '',
    `- **Backend support:** ${evidence.backend?.support || BACKEND_SUPPORT.UNAVAILABLE}`,
    `- **Inspectable:** ${evidence.backend?.inspectable ? 'yes' : 'no'}`,
    `- **Capability tokens:** ${(evidence.tokens || []).join(', ') || '—'}`,
    `- **Backend hits:** ${(evidence.backend?.hits || []).map((p) => `\`${p}\``).join(', ') || '—'}`,
    `- **Frontend hits:** ${(evidence.frontend?.hits || []).map((p) => `\`${p}\``).join(', ') || '—'}`,
    `- **Related tests:** ${(evidence.tests?.related || []).map((p) => `\`${p}\``).join(', ') || '—'}`,
    `- **Architecture review:** ${evidence.architecture?.reviewRequired ? 'required' : 'not required'} — ${evidence.architecture?.reason || ''}`,
  ].join('\n');
  if (text.includes('## Repository evidence (reconciled)')) {
    text = text.replace(/## Repository evidence \(reconciled\)[\s\S]*?(?=\n## |\n$)/, `${section}\n`);
  } else {
    text = `${text.trimEnd()}\n\n${section}\n`;
  }
  fs.writeFileSync(backendPath, text);
  return evidence;
}
