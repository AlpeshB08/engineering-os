import fs from 'node:fs';
import path from 'node:path';
import { ensureDir, eosDir, fileExists, knowledgeBaseDir } from '../paths.js';

const CATEGORIES = [
  'patterns',
  'anti-patterns',
  'adr',
  'playbooks',
  'repo-archetypes',
  'lessons-learned',
  'common-bugs',
  'implementation-patterns',
];

function parseEntry(filePath, rel, source) {
  let content = '';
  try {
    content = fs.readFileSync(filePath, 'utf8');
  } catch {
    return null;
  }
  if (path.basename(filePath) === 'README.md' || path.basename(filePath) === 'TEMPLATE.md') {
    return null;
  }
  const title = (content.match(/^#\s+(.+)$/m) || [, path.basename(filePath)])[1].trim();
  const id = (content.match(/^\s*-\s*\*\*ID:\*\*\s*(.+)$/m) ||
    content.match(/id:\s*([a-z0-9-]+)/i) || [, path.basename(filePath, '.md')])[1].trim();
  const type =
    (content.match(/^\s*-\s*\*\*Type:\*\*\s*(.+)$/m) ||
      content.match(/type:\s*([a-z0-9-]+)/i) || [, path.basename(path.dirname(filePath))])[1].trim();
  const tagsLine =
    (content.match(/^\s*-\s*\*\*Tags:\*\*\s*(.+)$/m) ||
      content.match(/tags:\s*\[?([^\\]\n]+)\]?/i) || [, ''])[1];
  const tags = tagsLine
    .split(/[, ]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean);
  const summary =
    (content.match(/^\s*-\s*\*\*Summary:\*\*\s*(.+)$/m) || [, ''])[1].trim() ||
    content
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('#') && !l.startsWith('- **'))
      .slice(0, 2)
      .join(' ')
      .slice(0, 200);

  return {
    id,
    type,
    tags,
    title,
    summary,
    path: rel,
    source,
    text: `${title} ${summary} ${tags.join(' ')} ${content}`.toLowerCase(),
  };
}

function walkMd(dir, base, source, out = []) {
  if (!fileExists(dir)) return out;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkMd(full, base, source, out);
    else if (ent.name.endsWith('.md')) {
      const rel = path.relative(base, full).split(path.sep).join('/');
      const entry = parseEntry(full, rel, source);
      if (entry) out.push(entry);
    }
  }
  return out;
}

export function buildKnowledgeIndex(frameworkHome, consumerRoot) {
  const entries = [];
  const fw = knowledgeBaseDir(frameworkHome);
  walkMd(fw, fw, 'framework', entries);
  const local = path.join(eosDir(consumerRoot), 'knowledge-base');
  walkMd(local, local, 'consumer', entries);

  const index = {
    version: 1,
    generated_at: new Date().toISOString(),
    count: entries.length,
    entries: entries.map(({ text, ...rest }) => rest),
  };

  // Store searchable text separately in memory only; persist lean index
  const indexPath = path.join(fw, 'index.json');
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2) + '\n');

  // Also consumer copy pointer
  ensureDir(path.join(eosDir(consumerRoot), 'knowledge-base'));
  fs.writeFileSync(
    path.join(eosDir(consumerRoot), 'knowledge-base', 'index.json'),
    JSON.stringify(index, null, 2) + '\n'
  );

  return { index, entries };
}

export function loadKnowledgeEntries(frameworkHome, consumerRoot) {
  const entries = [];
  const fw = knowledgeBaseDir(frameworkHome);
  walkMd(fw, fw, 'framework', entries);
  const local = path.join(eosDir(consumerRoot), 'knowledge-base');
  walkMd(local, local, 'consumer', entries);
  return entries;
}

export function searchKnowledge(frameworkHome, consumerRoot, query, limit = 10) {
  const q = String(query || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (!q.length) return [];
  const entries = loadKnowledgeEntries(frameworkHome, consumerRoot);
  const scored = [];
  for (const e of entries) {
    let score = 0;
    for (const t of q) {
      if (e.tags?.includes(t)) score += 5;
      if (e.title.toLowerCase().includes(t)) score += 3;
      if (e.summary.toLowerCase().includes(t)) score += 2;
      if (e.text.includes(t)) score += 1;
    }
    if (score > 0) scored.push({ ...e, score });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ text, ...rest }) => rest);
}

export function scaffoldKnowledgeEntry(consumerRoot, type, title) {
  const allowed = new Set([
    'lessons-learned',
    'common-bugs',
    'patterns',
    'anti-patterns',
    'implementation-patterns',
    'adr',
    'playbooks',
  ]);
  if (!allowed.has(type)) {
    throw new Error(`Unknown type '${type}'. Allowed: ${[...allowed].join(', ')}`);
  }
  const dir = path.join(eosDir(consumerRoot), 'knowledge-base', type);
  ensureDir(dir);
  const slug = String(title || 'untitled')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const file = path.join(dir, `${slug || 'entry'}.md`);
  if (fileExists(file)) throw new Error(`Already exists: ${file}`);
  const content = `# ${title || 'Untitled'}

- **ID:** ${slug}
- **Type:** ${type}
- **Tags:** engineering-os
- **Summary:** (one-line summary)

## Details

-

## Evidence / references

-
`;
  fs.writeFileSync(file, content);
  return file;
}

export { CATEGORIES };
