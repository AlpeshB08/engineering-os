import fs from 'node:fs';
import path from 'node:path';

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
]);

const CODE_EXT = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

function walk(root, files = [], base = root) {
  let entries;
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return files;
  }
  for (const ent of entries) {
    if (ent.name.startsWith('.') && ent.name !== '.github') {
      if (IGNORE_DIRS.has(ent.name)) continue;
      if (ent.name !== '.cursor' && ent.name !== '.claude') continue;
    }
    if (IGNORE_DIRS.has(ent.name)) continue;
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) walk(full, files, base);
    else if (CODE_EXT.has(path.extname(ent.name))) {
      files.push(path.relative(base, full).split(path.sep).join('/'));
    }
  }
  return files;
}

function classify(relPath) {
  const lower = relPath.toLowerCase();
  const base = path.basename(relPath);
  const name = base.replace(/\.(jsx?|tsx?|mjs|cjs)$/, '');

  if (
    /\/components\/ui\//.test(lower) ||
    /\/ui\//.test(lower) ||
    /\/design-system\//.test(lower) ||
    /\/tokens\//.test(lower)
  ) {
    return 'design_system';
  }
  if (/\/hooks\//.test(lower) || /^use[A-Z]/.test(name) || /\/use-[a-z]/.test(lower)) {
    return 'hooks';
  }
  if (/\/store\//.test(lower) || /\/stores\//.test(lower) || /\.store\./.test(lower)) {
    return 'stores';
  }
  if (/\/api\//.test(lower) || /\/apis\//.test(lower) || /\/services\//.test(lower)) {
    if (/\/api\//.test(lower) || /client/.test(lower) || /endpoint/.test(lower)) return 'apis';
    return 'services';
  }
  if (/\/utils\//.test(lower) || /\/helpers\//.test(lower) || /\/lib\//.test(lower)) {
    return 'utilities';
  }
  if (
    /\/routes\//.test(lower) ||
    /\/pages\//.test(lower) ||
    /\/app\/.*\/page\./.test(lower) ||
    /router/.test(lower)
  ) {
    return 'routes';
  }
  if (/\/components\//.test(lower) || /\.tsx$/.test(lower) || /\.jsx$/.test(lower)) {
    return 'components';
  }
  if (/\/controllers\//.test(lower) || /\/modules\//.test(lower) || /\/providers\//.test(lower)) {
    return 'services';
  }
  return 'other';
}

function extractImports(content) {
  const imports = [];
  const re =
    /(?:import\s+(?:[\s\S]*?)\s+from\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)|export\s+\*\s+from\s+['"]([^'"]+)['"])/g;
  let m;
  while ((m = re.exec(content))) {
    imports.push(m[1] || m[2] || m[3]);
  }
  return imports;
}

function detectConventions(root, files) {
  const conventions = [];
  if (files.some((f) => f.startsWith('src/'))) conventions.push('src-layout');
  if (files.some((f) => /components\/ui\//.test(f))) conventions.push('ui-primitives');
  if (files.some((f) => /\/store\//.test(f) || /\/stores\//.test(f))) {
    conventions.push('feature-stores');
  }
  if (files.some((f) => /\/api\//.test(f))) conventions.push('api-layer');
  if (fs.existsSync(path.join(root, 'tsconfig.json'))) conventions.push('typescript');
  if (fs.existsSync(path.join(root, '.prettierrc')) || fs.existsSync(path.join(root, '.prettierrc.json'))) {
    conventions.push('prettier');
  }
  if (files.some((f) => /\/const\//.test(f))) conventions.push('static-text-const');
  if (files.some((f) => /\/schemas\//.test(f))) conventions.push('validation-schemas');
  return conventions;
}

/**
 * Heuristic repository scan for Project DNA.
 * Evidence-based only; empty categories stay empty.
 */
export function scanRepository(root) {
  const files = walk(root);
  const inventory = {
    components: [],
    hooks: [],
    services: [],
    stores: [],
    utilities: [],
    routes: [],
    apis: [],
    design_system: [],
    other: [],
  };
  const importIndex = {};
  const reverseImports = {};

  for (const rel of files) {
    const kind = classify(rel);
    const entry = {
      path: rel,
      name: path.basename(rel).replace(/\.(jsx?|tsx?|mjs|cjs)$/, ''),
      kind,
    };
    inventory[kind].push(entry);

    let content = '';
    try {
      content = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    const imports = extractImports(content);
    importIndex[rel] = imports;
    for (const imp of imports) {
      if (!imp.startsWith('.') && !imp.startsWith('@/')) continue;
      const key = imp;
      if (!reverseImports[key]) reverseImports[key] = [];
      reverseImports[key].push(rel);
    }
  }

  const conventions = detectConventions(root, files);
  const counts = Object.fromEntries(
    Object.entries(inventory).map(([k, v]) => [k, v.length])
  );

  return {
    version: 1,
    scanned_at: new Date().toISOString(),
    root,
    file_count: files.length,
    counts,
    conventions,
    inventory,
    import_index: importIndex,
    reverse_imports: reverseImports,
  };
}

export function summarizeInventory(dna, limit = 8) {
  const lines = [];
  for (const [kind, items] of Object.entries(dna.inventory || {})) {
    if (!items.length) continue;
    const sample = items.slice(0, limit).map((i) => i.path);
    lines.push(`- **${kind}** (${items.length}): ${sample.join(', ')}${items.length > limit ? ', …' : ''}`);
  }
  return lines.join('\n');
}
