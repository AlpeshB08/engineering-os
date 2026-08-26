import fs from 'node:fs';
import path from 'node:path';
import { fileExists } from './paths.js';
import { today } from './util.js';

function cap(present, evidence = []) {
  return { present: Boolean(present), evidence };
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function hasAny(root, names) {
  return names.filter((n) => fileExists(path.join(root, n)));
}

export function detectCapabilities(root) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = fileExists(pkgPath) ? readJson(pkgPath) : null;
  const deps = {
    ...(pkg?.dependencies || {}),
    ...(pkg?.devDependencies || {}),
  };

  const evidence = {};

  const pm = hasAny(root, [
    'pnpm-lock.yaml',
    'yarn.lock',
    'package-lock.json',
    'bun.lockb',
  ]);
  evidence.package_manager = cap(pm.length > 0 || Boolean(pkg), pm.length ? pm : pkg ? ['package.json'] : []);

  const lintFiles = hasAny(root, [
    'eslint.config.js',
    'eslint.config.mjs',
    'eslint.config.cjs',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.cjs',
    '.eslintrc.json',
  ]);
  evidence.lint = cap(
    lintFiles.length > 0 || Boolean(deps.eslint),
    lintFiles.length ? lintFiles : deps.eslint ? ['package.json#eslint'] : []
  );

  const formatFiles = hasAny(root, [
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.cjs',
    '.prettierrc.json',
    'prettier.config.js',
    'prettier.config.cjs',
  ]);
  evidence.format = cap(
    formatFiles.length > 0 || Boolean(deps.prettier),
    formatFiles.length ? formatFiles : deps.prettier ? ['package.json#prettier'] : []
  );

  const testEvidence = [];
  if (deps.jest || deps.vitest || deps.mocha || deps['@playwright/test'] || deps.cypress) {
    testEvidence.push('package.json#test-deps');
  }
  const testConfigs = hasAny(root, [
    'jest.config.js',
    'jest.config.ts',
    'vitest.config.ts',
    'vitest.config.js',
    'playwright.config.ts',
    'cypress.config.ts',
  ]);
  testEvidence.push(...testConfigs);
  evidence['unit-tests'] = cap(
    Boolean(deps.jest || deps.vitest || deps.mocha) ||
      testConfigs.some((f) => f.includes('jest') || f.includes('vitest')),
    testEvidence
  );
  evidence['e2e-tests'] = cap(
    Boolean(deps['@playwright/test'] || deps.cypress) ||
      testConfigs.some((f) => f.includes('playwright') || f.includes('cypress')),
    testEvidence.filter((e) => /playwright|cypress/i.test(e))
  );

  const ci = hasAny(root, ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci']);
  evidence.ci = cap(ci.length > 0, ci);

  const mono = hasAny(root, [
    'pnpm-workspace.yaml',
    'turbo.json',
    'nx.json',
    'lerna.json',
  ]);
  if (pkg?.workspaces) mono.push('package.json#workspaces');
  evidence.monorepo = cap(mono.length > 0, mono);

  const backendMarkers = hasAny(root, [
    'prisma',
    'src/main.ts',
    'nest-cli.json',
    'manage.py',
    'go.mod',
    'Gemfile',
    'pom.xml',
    'build.gradle',
    'build.gradle.kts',
  ]);
  const backendDeps = [
    '@nestjs/core',
    'express',
    'fastify',
    'koa',
    'django',
    'flask',
  ].filter((d) => deps[d]);
  const backendEvidence = [
    ...backendMarkers,
    ...backendDeps.map((d) => `package.json#${d}`),
  ];
  evidence['backend-source'] = cap(backendEvidence.length > 0, backendEvidence);

  const feDeps = [
    'react',
    'vue',
    'svelte',
    'next',
    'nuxt',
    '@angular/core',
    'vite',
  ].filter((d) => deps[d]);
  const feMarkers = hasAny(root, ['vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.mjs']);
  evidence.frontend = cap(feDeps.length > 0 || feMarkers.length > 0, [
    ...feDeps.map((d) => `package.json#${d}`),
    ...feMarkers,
  ]);

  const apiClientHints = [
    'axios',
    '@tanstack/react-query',
    'swr',
    'graphql',
    'apollo-client',
  ].filter((d) => deps[d]);
  evidence['api-client-only'] = cap(
    evidence.frontend.present && !evidence['backend-source'].present && apiClientHints.length > 0,
    apiClientHints.map((d) => `package.json#${d}`)
  );

  const ds = hasAny(root, [
    'src/components/ui',
    'src/tokens',
    'packages/ui',
    'packages/design-system',
  ]);
  evidence['design-system'] = cap(ds.length > 0, ds);

  const authDeps = ['passport', 'next-auth', '@auth/core', 'jsonwebtoken'].filter(
    (d) => deps[d]
  );
  evidence.auth = cap(authDeps.length > 0, authDeps.map((d) => `package.json#${d}`));

  evidence.build = cap(
    Boolean(pkg?.scripts?.build) || feMarkers.length > 0,
    pkg?.scripts?.build ? ['package.json#scripts.build'] : feMarkers
  );
  evidence.typecheck = cap(
    Boolean(deps.typescript) || fileExists(path.join(root, 'tsconfig.json')),
    [
      ...(deps.typescript ? ['package.json#typescript'] : []),
      ...(fileExists(path.join(root, 'tsconfig.json')) ? ['tsconfig.json'] : []),
    ]
  );

  return evidence;
}

/**
 * Resolve runnable validation commands from package.json scripts and capabilities.
 */
export function detectRunnableCommands(root, capabilities) {
  const pkgPath = path.join(root, 'package.json');
  const pkg = fileExists(pkgPath) ? readJson(pkgPath) : null;
  const scripts = pkg?.scripts || {};
  const pm = capabilities.package_manager?.present
    ? capabilities.package_manager.evidence?.some((e) => e.includes('pnpm'))
      ? 'pnpm'
      : capabilities.package_manager.evidence?.some((e) => e.includes('yarn'))
        ? 'yarn'
        : 'npm'
    : 'npm';
  const run = (script) => `${pm} run ${script}`;

  const checks = [];

  if (capabilities.lint?.present && scripts.lint) {
    checks.push({ name: 'lint', command: run('lint'), capability: 'lint', include: true });
  } else if (capabilities.lint?.present) {
    checks.push({ name: 'lint', command: `${pm} exec eslint .`, capability: 'lint', include: true });
  }

  if (capabilities.typecheck?.present && scripts.typecheck) {
    checks.push({ name: 'typecheck', command: run('typecheck'), capability: 'typecheck', include: true });
  } else if (capabilities.typecheck?.present && scripts['type-check']) {
    checks.push({ name: 'typecheck', command: run('type-check'), capability: 'typecheck', include: true });
  } else if (capabilities.typecheck?.present) {
    checks.push({ name: 'typecheck', command: `${pm} exec tsc --noEmit`, capability: 'typecheck', include: true });
  }

  if (capabilities['unit-tests']?.present && scripts.test) {
    checks.push({ name: 'unit tests', command: run('test'), capability: 'unit-tests', include: true });
  }

  if (capabilities['e2e-tests']?.present && scripts['test:e2e']) {
    checks.push({ name: 'e2e', command: run('test:e2e'), capability: 'e2e-tests', include: true });
  } else if (capabilities['e2e-tests']?.present && scripts.e2e) {
    checks.push({ name: 'e2e', command: run('e2e'), capability: 'e2e-tests', include: true });
  }

  if (capabilities.build?.present && scripts.build) {
    checks.push({ name: 'build', command: run('build'), capability: 'build', include: true });
  }

  return checks;
}

export function detectArchetype(capabilities) {
  const mono = capabilities.monorepo?.present;
  const fe = capabilities.frontend?.present;
  const be = capabilities['backend-source']?.present;
  if (mono) return 'monorepo';
  if (fe && be) return 'fullstack';
  if (fe) return 'frontend';
  if (be) return 'backend';
  return 'unknown';
}

export function renderRepositoryProfile({ root, capabilities, archetype }) {
  const rows = Object.entries(capabilities)
    .map(
      ([name, info]) =>
        `| ${name} | ${info.present ? 'yes' : 'no'} | ${(info.evidence || []).join(', ') || '—'} |`
    )
    .join('\n');

  return `# Repository Profile

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** ${today()}
- **Root:** ${root}
- **Archetype:** ${archetype}

## Summary

Detected archetype **${archetype}** from filesystem and manifest evidence. Treat absences as unavailable — do not assume missing systems.

## Stack (evidenced)

| Area | Finding | Evidence |
|------|---------|----------|
| Languages | See capabilities / manifests | package.json, lockfiles, language markers |
| Frameworks | See frontend/backend capabilities | dependency and config evidence |
| Package manager | ${capabilities.package_manager?.present ? 'detected' : 'unknown'} | ${(capabilities.package_manager?.evidence || []).join(', ') || '—'} |
| Build tool | ${capabilities.build?.present ? 'detected' : 'unknown'} | ${(capabilities.build?.evidence || []).join(', ') || '—'} |
| Test runner | ${capabilities['unit-tests']?.present || capabilities['e2e-tests']?.present ? 'detected' : 'unknown'} | see capabilities |
| Linter / formatter | lint=${capabilities.lint?.present ? 'yes' : 'no'}, format=${capabilities.format?.present ? 'yes' : 'no'} | see capabilities |
| CI | ${capabilities.ci?.present ? 'detected' : 'not detected'} | ${(capabilities.ci?.evidence || []).join(', ') || '—'} |

## Layout

Inspect the repository tree during discovery and extend this section with key directories.

## Capabilities

| Capability | Present | Evidence |
|------------|---------|----------|
${rows}

## Backend availability

- **Status:** ${capabilities['backend-source']?.present ? 'yes' : capabilities['api-client-only']?.present ? 'unknown' : 'unknown'}
- **Notes:** ${
    capabilities['backend-source']?.present
      ? 'Backend source markers detected in this repository.'
      : capabilities['api-client-only']?.present
        ? 'API client dependencies detected without backend source markers. Do not assume backend access.'
        : 'No clear backend evidence. Do not invent APIs.'
  }

## Reuse inventory

| Candidate | Path | Notes |
|-----------|------|-------|
| _(fill during discovery)_ | | |

## Constraints & conventions

- Follow existing repository patterns before inventing new ones.
- Never assume missing capabilities listed as \`no\` above.

## Unknowns

- Fill during discovery with explicit questions for humans.
`;
}
