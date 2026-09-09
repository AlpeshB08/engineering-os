/**
 * Adaptive Test Capability Manager — repository-agnostic testing infrastructure detection,
 * strategy resolution, setup proposals, and execution failure classification.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileExists } from '../paths.js';
import { detectCapabilities } from '../detect.js';
import { authorizeApplicationMutation } from '../guard.js';
import { loadState } from '../state.js';

function isManualFallbackResolved(run, kind) {
  const decisions = run.workflow_decisions || {};
  const automation = decisions[`${kind}-automation`];
  if (
    automation?.status === 'answered' &&
    (automation.selectedOption === 'manual_qa' ||
      automation.selectedOption === `proceed_without_${kind}` ||
      automation.selectedOption === 'proceed_without_e2e' ||
      automation.selectedOption === 'proceed_without_unit')
  ) {
    return true;
  }
  const failure = decisions[`${kind}-setup-failure`];
  if (failure?.status === 'answered' && failure.selectedOption === 'manual_qa') {
    return true;
  }
  return run.test_capability_decisions?.[kind] === 'declined';
}

export const CAPABILITY_STATUS = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  PARTIAL: 'partially_configured',
  UNCERTAIN: 'configuration_detected_execution_uncertain',
};

export const FAILURE_CLASS = {
  TEST: 'test_failure',
  APPLICATION: 'application_failure',
  INFRASTRUCTURE: 'infrastructure_failure',
};

export const SETUP_VERIFICATION = {
  READY: 'ready',
  PARTIAL: 'partial',
  FAILED: 'failed',
  STAGED: 'staged',
};

const UNIT_FRAMEWORKS = ['vitest', 'jest', 'mocha', 'pytest', 'junit'];
const E2E_FRAMEWORKS = ['playwright', 'cypress', 'selenium', 'webdriverio'];

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

function globExists(root, patterns) {
  const found = [];
  function walk(dir, depth = 0) {
    if (depth > 4) return;
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      for (const pattern of patterns) {
        if (rel.includes(pattern) || entry.name === pattern) {
          found.push(rel);
        }
      }
      if (entry.isDirectory()) walk(full, depth + 1);
    }
  }
  walk(root);
  return [...new Set(found)];
}

function normalizeRel(root, filePath) {
  return path.relative(root, filePath).split(path.sep).join('/');
}

function detectPackageManager(root, baseCapabilities = {}) {
  if (fileExists(path.join(root, 'bun.lockb')) || fileExists(path.join(root, 'bunfig.toml'))) {
    return 'bun';
  }
  if (baseCapabilities.package_manager?.present) {
    const evidence = baseCapabilities.package_manager.evidence || [];
    if (evidence.some((e) => e.includes('pnpm'))) return 'pnpm';
    if (evidence.some((e) => e.includes('yarn'))) return 'yarn';
    if (evidence.some((e) => e.includes('bun'))) return 'bun';
  }
  if (fileExists(path.join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (fileExists(path.join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

export function buildPackageManagerCommand(pm, verb, ...args) {
  const pkgArgs = args.filter(Boolean).join(' ');
  switch (pm) {
    case 'pnpm':
      if (verb === 'install') return 'pnpm install';
      if (verb === 'add-dev') return `pnpm add -D ${pkgArgs}`;
      if (verb === 'run') return `pnpm run ${pkgArgs}`;
      if (verb === 'exec') return `pnpm exec ${pkgArgs}`;
      return `pnpm ${verb} ${pkgArgs}`.trim();
    case 'yarn':
      if (verb === 'install') return 'yarn install';
      if (verb === 'add-dev') return `yarn add -D ${pkgArgs}`;
      if (verb === 'run') return `yarn run ${pkgArgs}`;
      if (verb === 'exec') return `yarn exec ${pkgArgs}`;
      return `yarn ${verb} ${pkgArgs}`.trim();
    case 'bun':
      if (verb === 'install') return 'bun install';
      if (verb === 'add-dev') return `bun add -d ${pkgArgs}`;
      if (verb === 'run') return `bun run ${pkgArgs}`;
      if (verb === 'exec') return `bunx ${pkgArgs}`;
      return `bun ${verb} ${pkgArgs}`.trim();
    default:
      if (verb === 'install') return 'npm install';
      if (verb === 'add-dev') return `npm install --save-dev ${pkgArgs}`;
      if (verb === 'run') return `npm run ${pkgArgs}`;
      if (verb === 'exec') return `npx ${pkgArgs}`;
      return `npm ${verb} ${pkgArgs}`.trim();
  }
}

export function detectRepositoryEcosystem(root, baseCapabilities = null) {
  const caps = baseCapabilities || detectCapabilities(root);
  const pkgPath = path.join(root, 'package.json');
  const pkg = fileExists(pkgPath) ? readJson(pkgPath) : null;
  const languages = [];
  if (fileExists(path.join(root, 'package.json')) || globExists(root, ['.js', '.jsx']).length) {
    languages.push('javascript');
  }
  if (fileExists(path.join(root, 'tsconfig.json')) || globExists(root, ['.ts', '.tsx']).length) {
    languages.push('typescript');
  }
  if (fileExists(path.join(root, 'pyproject.toml')) || fileExists(path.join(root, 'requirements.txt'))) {
    languages.push('python');
  }
  if (fileExists(path.join(root, 'go.mod'))) languages.push('go');
  if (fileExists(path.join(root, 'pom.xml')) || fileExists(path.join(root, 'build.gradle'))) {
    languages.push('java');
  }
  if (fileExists(path.join(root, 'Gemfile'))) languages.push('ruby');
  if (fileExists(path.join(root, 'composer.json'))) languages.push('php');
  if (globExists(root, ['.csproj']).length) languages.push('dotnet');

  const application = [];
  if (caps.frontend?.present) application.push('frontend');
  if (caps['backend-source']?.present) application.push('backend');
  if (caps.monorepo?.present) application.push('monorepo');
  if (caps['api-client-only']?.present) application.push('api-client');

  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const frameworks = [];
  for (const key of ['react', 'vue', 'next', 'nuxt', 'svelte', '@angular/core', 'vite']) {
    if (deps[key]) frameworks.push(key);
  }

  return {
    packageManager: detectPackageManager(root, caps),
    languages: {
      primary: languages[0] || 'unknown',
      detected: languages,
    },
    application: {
      types: application,
      frameworks,
    },
    monorepo: Boolean(caps.monorepo?.present),
    evidence: [
      ...(caps.package_manager?.evidence || []),
      ...(languages.map((l) => `language:${l}`)),
      ...(application.map((a) => `application:${a}`)),
    ],
  };
}

function inferFrameworkFromEvidence(evidence = [], kind = 'unit') {
  const joined = evidence.join(' ').toLowerCase();
  const frameworks = kind === 'unit' ? UNIT_FRAMEWORKS : E2E_FRAMEWORKS;
  for (const fw of frameworks) {
    if (joined.includes(fw)) return fw;
  }
  return null;
}

function resolveRunCommand(root, pkg, pm, scripts, scriptNames, framework) {
  for (const name of scriptNames) {
    if (scripts[name]) return `${pm} run ${name}`;
  }
  if (framework === 'vitest') return `${pm} exec vitest run`;
  if (framework === 'jest') return `${pm} exec jest`;
  if (framework === 'playwright') return `${pm} exec playwright test`;
  if (framework === 'cypress') return `${pm} exec cypress run`;
  return null;
}

function assessUnitCapability(root, baseCapabilities = {}, pkg = null) {
  pkg = pkg || (fileExists(path.join(root, 'package.json')) ? readJson(path.join(root, 'package.json')) : null);
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts = pkg?.scripts || {};
  const pm = detectPackageManager(root, baseCapabilities);

  const configFiles = hasAny(root, [
    'jest.config.js',
    'jest.config.ts',
    'jest.config.mjs',
    'vitest.config.ts',
    'vitest.config.js',
    'vitest.config.mjs',
    'pytest.ini',
    'pyproject.toml',
  ]);
  const testDirs = globExists(root, ['__tests__', 'tests/unit', 'test/unit', 'tests']);
  const depEvidence = [
    ...UNIT_FRAMEWORKS.filter((f) => deps[f]).map((f) => `package.json#${f}`),
    ...(fileExists(path.join(root, 'pyproject.toml')) ? ['pyproject.toml'] : []),
  ];
  const evidence = [...configFiles, ...depEvidence, ...testDirs.slice(0, 5)];
  const framework = inferFrameworkFromEvidence([...configFiles, ...depEvidence], 'unit');
  const hasScript = Boolean(scripts.test || scripts['test:unit']);
  const hasConfig = configFiles.length > 0;
  const hasDepsOnly = depEvidence.length > 0 && !hasConfig && !hasScript;

  let status = CAPABILITY_STATUS.UNAVAILABLE;
  const gaps = [];

  if (hasConfig && hasScript) {
    status = CAPABILITY_STATUS.AVAILABLE;
  } else if (hasConfig || hasScript) {
    status = CAPABILITY_STATUS.PARTIAL;
    if (!hasScript) gaps.push('missing test script in package.json');
    if (!hasConfig) gaps.push('missing unit test configuration file');
  } else if (hasDepsOnly || testDirs.length) {
    status = CAPABILITY_STATUS.UNCERTAIN;
    if (hasDepsOnly) gaps.push('dependency detected without runnable test script/config');
    if (testDirs.length && !hasScript) gaps.push('test files present but no standard test script');
  }

  const runCommand = resolveRunCommand(root, pkg, pm, scripts, ['test', 'test:unit'], framework);

  return {
    kind: 'unit',
    status,
    framework,
    evidence,
    configPaths: configFiles,
    testScriptPresent: hasScript,
    runCommand: status === CAPABILITY_STATUS.AVAILABLE ? runCommand : runCommand || null,
    gaps,
    reuseDecision: evaluateReuseDecision(root, 'unit', { framework, evidence, status }),
  };
}

/** True when an e2e directory contains at least one spec/test file. */
function hasE2eSpecFiles(root, dirs = []) {
  const specPattern = /\.(spec|test|cy)\.[cm]?[jt]sx?$/i;
  const walk = (absDir, depth = 0) => {
    if (depth > 3) return false;
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const entry of entries) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const abs = path.join(absDir, entry.name);
      if (entry.isFile() && specPattern.test(entry.name)) return true;
      if (entry.isDirectory() && walk(abs, depth + 1)) return true;
    }
    return false;
  };
  return dirs.some((dir) => walk(path.join(root, dir)));
}

/**
 * Why E2E is not runnable for this run, in the user's terms. A repository that has
 * Playwright or Cypress set up must never be told it has "no E2E framework" — the real
 * situation is either a setup gap in this repository or simply that this feature has no
 * E2E coverage yet, and those call for different decisions.
 */
export function describeE2eUnavailability(cap = {}) {
  const framework = cap.framework;
  const gaps = (cap.gaps || []).filter(Boolean);
  if (!framework) {
    return 'E2E is appropriate for this feature, but no E2E framework is configured in this repository.';
  }
  const named = framework.charAt(0).toUpperCase() + framework.slice(1);
  if (cap.status === CAPABILITY_STATUS.UNCERTAIN) {
    return `E2E is appropriate for this feature. **${named}** is a dependency of this repository, but there is no runnable script or config, so EOS cannot execute it${gaps.length ? ` (${gaps.join('; ')})` : ''}.`;
  }
  return `E2E is appropriate for this feature. This repository does have **${named}** set up, but EOS cannot run it for this feature${gaps.length ? ` (${gaps.join('; ')})` : ''} — so this change would not get real E2E coverage.`;
}

function assessE2eCapability(root, baseCapabilities = {}, pkg = null) {
  pkg = pkg || (fileExists(path.join(root, 'package.json')) ? readJson(path.join(root, 'package.json')) : null);
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const scripts = pkg?.scripts || {};
  const pm = detectPackageManager(root, baseCapabilities);

  // Config discovery must cover the extensions and nested layouts real projects use —
  // a config under e2e/ or tests/ is just as valid as one at the repository root.
  const configNames = [];
  for (const base of ['playwright.config', 'cypress.config']) {
    for (const ext of ['ts', 'js', 'mjs', 'cjs', 'mts', 'cts']) configNames.push(`${base}.${ext}`);
  }
  configNames.push('wdio.conf.js', 'wdio.conf.ts', 'wdio.conf.mjs');
  const configLocations = ['', 'e2e/', 'tests/', 'test/', 'config/', 'playwright/', 'cypress/'];
  const configFiles = hasAny(
    root,
    configLocations.flatMap((dir) => configNames.map((name) => `${dir}${name}`))
  );
  const e2eDirs = globExists(root, ['e2e', 'tests/e2e', 'cypress', 'playwright']);
  const depEvidence = [
    deps['@playwright/test'] ? 'package.json#@playwright/test' : null,
    deps.cypress ? 'package.json#cypress' : null,
    deps.selenium ? 'package.json#selenium-webdriver' : null,
    deps.webdriverio ? 'package.json#webdriverio' : null,
  ].filter(Boolean);
  const evidence = [...configFiles, ...depEvidence, ...e2eDirs.slice(0, 5)];
  const framework = inferFrameworkFromEvidence([...configFiles, ...depEvidence], 'e2e');
  const hasScript = Boolean(scripts['test:e2e'] || scripts.e2e);
  const hasConfig = configFiles.length > 0;
  const hasDepsOnly = depEvidence.length > 0 && !hasConfig && !hasScript;

  let status = CAPABILITY_STATUS.UNAVAILABLE;
  const gaps = [];

  // A runnable suite is what matters, not the presence of a config file: Playwright and
  // Cypress both run with built-in defaults. A framework dependency plus a runnable e2e
  // script plus actual spec files is a working E2E setup even with no config on disk.
  const hasSpecs = e2eDirs.length > 0 && hasE2eSpecFiles(root, e2eDirs);
  const runnableWithoutConfig = Boolean(framework) && hasScript && hasSpecs;

  if ((hasConfig && hasScript) || runnableWithoutConfig) {
    status = CAPABILITY_STATUS.AVAILABLE;
    if (!hasConfig) gaps.push('no e2e config file found — running with framework defaults');
  } else if (hasConfig || hasScript || (e2eDirs.length && framework)) {
    status = CAPABILITY_STATUS.PARTIAL;
    if (!hasScript) gaps.push('missing e2e script in package.json');
    if (!hasConfig) gaps.push('missing e2e configuration file');
  } else if (hasDepsOnly) {
    status = CAPABILITY_STATUS.UNCERTAIN;
    gaps.push('e2e dependency detected without runnable script/config');
  }

  const runCommand = resolveRunCommand(root, pkg, pm, scripts, ['test:e2e', 'e2e'], framework);

  return {
    kind: 'e2e',
    status,
    framework,
    evidence,
    configPaths: configFiles,
    testScriptPresent: hasScript,
    runCommand: status === CAPABILITY_STATUS.AVAILABLE ? runCommand : runCommand || null,
    gaps,
    pageObjects: detectPageObjectStructure(root),
    reuseDecision: evaluateReuseDecision(root, 'e2e', { framework, evidence, status }),
  };
}

export function detectDevServerCapability(root, pkg = null) {
  pkg = pkg || (fileExists(path.join(root, 'package.json')) ? readJson(path.join(root, 'package.json')) : null);
  const scripts = pkg?.scripts || {};
  const scriptNames = ['dev', 'start', 'serve', 'preview'];
  const present = scriptNames.find((name) => scripts[name]);
  return {
    status: present ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.UNAVAILABLE,
    script: present || null,
    command: present ? `${detectPackageManager(root)} run ${present}` : null,
    evidence: present ? [`package.json#scripts.${present}`] : [],
  };
}

export function detectAuthFixtures(root) {
  const matches = globExists(root, [
    'fixtures/auth',
    'e2e/fixtures',
    'playwright/.auth',
    'cypress/fixtures',
    'test/fixtures',
  ]).filter((p) => /auth|login|session|fixture/i.test(p));
  return {
    status: matches.length ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.UNAVAILABLE,
    paths: matches.slice(0, 8),
    evidence: matches.slice(0, 8),
  };
}

export function detectPageObjectStructure(root) {
  const matches = globExists(root, ['page-objects', 'pages', 'pom', 'pageObjects']).filter((p) =>
    /e2e|playwright|cypress|tests/i.test(p)
  );
  return {
    status: matches.length ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.UNAVAILABLE,
    paths: matches.slice(0, 8),
    pattern: matches.some((p) => /page-objects|pageObjects|pom/i.test(p)) ? 'page-object-model' : 'inline/spec',
  };
}

export function detectTestUtilities(root) {
  const matches = globExists(root, ['testing-library', 'test-utils', 'testUtils', 'test/helpers']);
  return {
    status: matches.length ? CAPABILITY_STATUS.AVAILABLE : CAPABILITY_STATUS.UNAVAILABLE,
    paths: matches.slice(0, 8),
    evidence: matches.slice(0, 8),
  };
}

export function evaluateReuseDecision(root, kind, cap = {}) {
  if (cap.status === CAPABILITY_STATUS.AVAILABLE) {
    return {
      required: false,
      existingPattern: cap.framework || 'repository setup',
      introduceNew: false,
      reason: `Reuse existing ${kind} testing setup (${cap.framework || 'detected'}).`,
    };
  }
  if (cap.status === CAPABILITY_STATUS.PARTIAL || cap.status === CAPABILITY_STATUS.UNCERTAIN) {
    return {
      required: true,
      existingPattern: cap.framework || 'partial setup',
      introduceNew: false,
      reason: `Extend existing ${kind} patterns before introducing a new framework.`,
    };
  }
  return {
    required: true,
    existingPattern: null,
    introduceNew: true,
    reason: `No usable ${kind} automation detected; minimal supported framework may be proposed after approval.`,
  };
}

export function isAutomationAvailable(cap = {}) {
  return cap.status === CAPABILITY_STATUS.AVAILABLE;
}

export function detectTestCapabilities(root, baseCapabilities = null) {
  const caps = baseCapabilities || detectCapabilities(root);
  const ecosystem = detectRepositoryEcosystem(root, caps);
  const pkgPath = path.join(root, 'package.json');
  const pkg = fileExists(pkgPath) ? readJson(pkgPath) : null;
  const unit = assessUnitCapability(root, caps, pkg);
  const e2e = assessE2eCapability(root, caps, pkg);

  return {
    ecosystem,
    unit,
    e2e,
    browser: {
      ...e2e,
      kind: 'browser',
    },
    devServer: detectDevServerCapability(root, pkg),
    authFixtures: detectAuthFixtures(root),
    testUtilities: detectTestUtilities(root),
    packageManager: ecosystem.packageManager,
    detectedAt: new Date().toISOString(),
  };
}

export function computeRiskAutomationNeeds(signals = {}, context = {}) {
  const highRisk = signals.high_risk?.length > 0;
  const multiStep = signals.multi_step?.length > 0 || signals.user_journey_complexity;
  const lowRiskOnly =
    signals.low_risk_visual?.length >= 2 &&
    !signals.has_business_logic &&
    !highRisk &&
    !multiStep;

  if (lowRiskOnly) return { unit: false, e2e: false };

  if (signals.has_business_logic && !signals.user_facing) {
    return { unit: true, e2e: false };
  }
  if (highRisk || multiStep) return { unit: true, e2e: true };
  if (signals.user_facing && signals.has_business_logic) return { unit: true, e2e: true };
  if (signals.user_facing) return { unit: false, e2e: true };
  return {
    unit: Boolean(signals.has_business_logic),
    e2e: false,
  };
}

function getFrameworkPackages(framework, kind) {
  if (kind === 'unit') {
    if (framework === 'jest') return [{ name: 'jest', dev: true }];
    if (framework === 'vitest') return [{ name: 'vitest', dev: true }];
    if (framework === 'pytest') return [{ name: 'pytest', dev: true }];
    return [{ name: framework, dev: true }];
  }
  if (framework === 'playwright') return [{ name: '@playwright/test', dev: true }];
  if (framework === 'cypress') return [{ name: 'cypress', dev: true }];
  if (framework === 'webdriverio') return [{ name: 'webdriverio', dev: true }];
  return [{ name: framework, dev: true }];
}

function recommendFramework(root, kind, testCapabilities = {}) {
  const ecosystem = testCapabilities.ecosystem || detectRepositoryEcosystem(root);
  const pkg = fileExists(path.join(root, 'package.json')) ? readJson(path.join(root, 'package.json')) : null;
  const deps = { ...(pkg?.dependencies || {}), ...(pkg?.devDependencies || {}) };
  const partial = kind === 'unit' ? testCapabilities.unit : testCapabilities.e2e;

  if (partial?.framework) return partial.framework;

  if (ecosystem.languages.primary === 'python') return kind === 'unit' ? 'pytest' : 'playwright';
  if (ecosystem.languages.primary === 'java') return kind === 'unit' ? 'junit' : 'selenium';

  if (kind === 'unit') {
    if (deps.jest) return 'jest';
    if (deps.vitest || fileExists(path.join(root, 'vite.config.ts'))) return 'vitest';
    if (deps.mocha) return 'mocha';
    if (ecosystem.application.frameworks.includes('vite')) return 'vitest';
    return 'vitest';
  }
  if (deps['@playwright/test']) return 'playwright';
  if (deps.cypress) return 'cypress';
  if (deps.webdriverio) return 'webdriverio';
  return 'playwright';
}

export function buildSetupProposal(root, kind, testCapabilities = {}) {
  const cap = kind === 'unit' ? testCapabilities.unit : testCapabilities.e2e;
  const ecosystem = testCapabilities.ecosystem || detectRepositoryEcosystem(root);
  const framework = recommendFramework(root, kind, testCapabilities);
  const reuse = cap?.reuseDecision || evaluateReuseDecision(root, kind, cap);
  const packages = getFrameworkPackages(framework, kind);
  const pm = ecosystem.packageManager;

  const files =
    kind === 'unit'
      ? framework === 'pytest'
        ? ['pyproject.toml', 'tests/test_smoke.py']
        : framework === 'jest'
          ? ['jest.config.js', 'tests/unit/smoke.test.js']
          : [`vitest.config.ts`, `tests/unit/smoke.test.ts`]
      : framework === 'cypress'
        ? ['cypress.config.ts', 'tests/e2e/smoke.cy.ts']
        : [`playwright.config.ts`, `tests/e2e/smoke.spec.ts`];

  const whyFits = ecosystem.languages.primary === 'python'
    ? `${framework} fits Python ecosystem detected in repository.`
    : `${framework} fits ${ecosystem.languages.detected.join('/')} + ${ecosystem.application.types.join(', ') || 'application'} stack.`;

  return {
    kind,
    requiredCapability: kind === 'unit' ? 'Unit test automation' : 'E2E / browser automation',
    recommendedFramework: framework,
    ecosystem,
    packageManager: pm,
    reason: reuse.reason,
    whyFitsEcosystem: whyFits,
    whyExistingRepoCannotSatisfy: (cap?.gaps || ['No runnable automation detected']).join('; '),
    filesToAddOrModify: files,
    dependencies: packages,
    dependencyChanges: packages.map((p) => `${p.dev ? 'devDependency' : 'dependency'}: ${p.name}`),
    installCommand: buildPackageManagerCommand(pm, 'add-dev', ...packages.map((p) => p.name)),
    setupAssumptions: [
      'Minimal configuration aligned with detected ecosystem',
      'Uses detected package manager — not hard-coded npm',
      'No consumer application feature code changes',
    ],
    reuseDecision: reuse,
  };
}

export function resolveTestStrategyWithCapabilities({
  strategy = {},
  testCapabilities = {},
  run = {},
  root = '',
}) {
  const decisions = run.test_capability_decisions || {};
  const risk = strategy.risk || computeRiskAutomationNeeds(strategy.signals || {});
  const proposals = [];
  let unit = { ...strategy.unit };
  let e2e = { ...strategy.e2e };
  let manual = { ...strategy.manual };

  function resolveKind(kind, riskNeeded, cap, current) {
    if (!riskNeeded) {
      return { ...current, required: false };
    }
    if (decisions[kind] === 'declined') {
      return {
        required: false,
        reason: `User declined ${kind} infrastructure setup — manual QA fallback applies.`,
      };
    }
    if (decisions[kind] === 'setup_failed') {
      if (!isManualFallbackResolved(run, kind)) {
        return {
          required: true,
          pendingApproval: true,
          setupFailed: true,
          reason: `${kind} setup failed verification — explicit decision required: retry setup or fall back to Manual QA.`,
        };
      }
      return {
        required: false,
        reason: `${kind} setup failed verification — manual QA fallback applies.`,
      };
    }
    if (isAutomationAvailable(cap)) {
      return {
        required: true,
        reason: current.reason || `Required ${kind} automation is available in this repository.`,
      };
    }
    if (decisions[kind] === 'approved') {
      const verified = run.test_capability_verification?.[kind];
      if (verified?.status === SETUP_VERIFICATION.FAILED) {
        return {
          required: false,
          reason: `${kind} setup failed verification — manual QA fallback applies.`,
        };
      }
      if (isAutomationAvailable(cap) || verified?.status === SETUP_VERIFICATION.READY || verified?.status === SETUP_VERIFICATION.STAGED) {
        return {
          required: true,
          reason: `User approved ${kind} setup; capability verified usable.`,
        };
      }
      return {
        required: true,
        reason: `User approved minimal ${kind} test infrastructure setup for this feature.`,
      };
    }
    if (kind === 'e2e') {
      // "No E2E framework" is only one of the reasons E2E can be unavailable, and it is
      // the wrong thing to tell someone whose repository does have Playwright or Cypress
      // set up. Say which situation this actually is.
      const cap = testCapabilities?.e2e || {};
      return {
        required: false,
        pendingApproval: true,
        appropriate: true,
        available: false,
        framework: cap.framework || null,
        capabilityStatus: cap.status || null,
        gaps: cap.gaps || [],
        reason: `${describeE2eUnavailability(cap)} Explicit user decision is required to proceed without E2E. An E2E framework will not be installed.`,
      };
    }
    proposals.push(buildSetupProposal(root, kind, testCapabilities));
    return {
      required: true,
      pendingApproval: true,
      reason: `${kind === 'unit' ? 'Unit' : 'E2E'} automation is appropriate but unavailable — explicit user decision is required before continuing.`,
    };
  }

  unit = resolveKind('unit', risk.unit, testCapabilities.unit, unit);
  e2e = resolveKind('e2e', risk.e2e, testCapabilities.e2e, e2e);

  const automationFallback =
    (decisions.unit === 'declined' && risk.unit) ||
    (decisions.e2e === 'declined' && risk.e2e) ||
    (decisions.unit === 'setup_failed' && risk.unit && isManualFallbackResolved(run, 'unit')) ||
    (decisions.e2e === 'setup_failed' && risk.e2e && isManualFallbackResolved(run, 'e2e'));

  if (automationFallback) {
    manual = {
      required: true,
      reason:
        'Manual QA required because automated setup was declined or failed for one or more required capabilities.',
    };
  }

  const needsApproval = proposals.length > 0;
  const pendingKinds = proposals.map((p) => p.kind);
  const strategy_label = deriveResolvedLabel(unit, e2e, manual);

  return {
    strategy: {
      ...strategy,
      unit,
      e2e,
      manual,
      risk,
      strategy_label,
      repository: {
        unit_framework: testCapabilities.unit?.framework || strategy.repository?.unit_framework || 'Not detected',
        e2e_framework: testCapabilities.e2e?.framework || strategy.repository?.e2e_framework || 'Not detected',
        unit_status: testCapabilities.unit?.status,
        e2e_status: testCapabilities.e2e?.status,
      },
    },
    testCapabilities,
    proposals,
    pendingKinds,
    needsApproval,
  };
}

export function isTestCapabilityDecisionPending(resolved = {}, run = {}) {
  if (resolved.strategy?.e2e?.pendingApproval && run.test_capability_decisions?.e2e !== 'declined') {
    const e2eDecision = run.workflow_decisions?.['e2e-automation'];
    if (!e2eDecision || e2eDecision.status !== 'answered') return true;
  }
  if (!resolved.needsApproval) return false;
  const gateStatus = run.gates?.['test-capability-setup']?.status;
  return gateStatus !== 'approved' && gateStatus !== 'rejected';
}

function deriveResolvedLabel(unit, e2e, manual) {
  const pendingParts = [];
  if (unit.pendingApproval) pendingParts.push('Unit');
  if (e2e.pendingApproval) pendingParts.push('E2E');
  if (pendingParts.length) {
    return `${pendingParts.join(' + ')} (pending setup approval)`;
  }
  if (unit.required && e2e.required) return 'Unit + E2E';
  if (unit.required) return 'Unit only';
  if (e2e.required) return 'E2E only';
  if (manual.required) return 'Manual only';
  return 'Manual only';
}

export function renderApprovalRequest(proposal = {}) {
  const eco = proposal.ecosystem || {};
  return `Test capability required: ${proposal.requiredCapability}

Detected ecosystem: ${eco.languages?.detected?.join(' + ') || 'unknown'} (${proposal.packageManager || 'unknown'})

Recommended framework: ${proposal.recommendedFramework}

Reason: ${proposal.whyFitsEcosystem || proposal.reason}

Why existing repo cannot satisfy: ${proposal.whyExistingRepoCannotSatisfy}

Planned changes:
${(proposal.filesToAddOrModify || []).map((f) => `- ${f}`).join('\n')}

Dependencies:
${(proposal.dependencyChanges || []).map((d) => `- ${d}`).join('\n')}

Install command: \`${proposal.installCommand || '—'}\`

This proposal is recorded for review only. The /feature workflow does not automatically install or configure E2E frameworks.`;
}

export function renderTestCapabilitySection(testCapabilities = {}, proposals = []) {
  const eco = testCapabilities.ecosystem || {};
  const row = (label, cap) =>
    `| ${label} | ${cap.status} | ${cap.framework || '—'} | ${(cap.evidence || []).slice(0, 3).join(', ') || '—'} |`;

  const proposalLines = proposals.length
    ? proposals
        .map((p) => `\n${renderApprovalRequest(p)}\n`)
        .join('\n---\n')
    : '- _(no setup proposals — existing capabilities sufficient or manual fallback selected)_';

  return `## Test Capability Assessment

### Repository ecosystem

- Package manager: **${eco.packageManager || testCapabilities.packageManager || 'unknown'}**
- Languages: ${(eco.languages?.detected || []).join(', ') || 'unknown'}
- Application: ${(eco.application?.types || []).join(', ') || 'unknown'}
- Monorepo: ${eco.monorepo ? 'yes' : 'no'}

| Capability | Status | Framework | Evidence |
|------------|--------|-----------|----------|
${row('Unit tests', testCapabilities.unit || { status: 'unavailable' })}
${row('E2E / browser', testCapabilities.e2e || { status: 'unavailable' })}
| Dev server | ${testCapabilities.devServer?.status || 'unavailable'} | ${testCapabilities.devServer?.script || '—'} | ${(testCapabilities.devServer?.evidence || []).join(', ') || '—'} |
| Auth fixtures | ${testCapabilities.authFixtures?.status || 'unavailable'} | — | ${(testCapabilities.authFixtures?.paths || []).slice(0, 2).join(', ') || '—'} |
| Page objects | ${testCapabilities.e2e?.pageObjects?.status || 'unavailable'} | ${testCapabilities.e2e?.pageObjects?.pattern || '—'} | ${(testCapabilities.e2e?.pageObjects?.paths || []).slice(0, 2).join(', ') || '—'} |
| Test utilities | ${testCapabilities.testUtilities?.status || 'unavailable'} | — | ${(testCapabilities.testUtilities?.paths || []).slice(0, 2).join(', ') || '—'} |

### Setup proposals

${proposalLines}
`;
}

function testCapabilityStagingDir(root, runId) {
  return path.join(root, '.engineering-os', 'test-setup-staging', runId);
}

export function isApplicationMutationPermittedForSetup(root, run) {
  if (!root || !run || typeof run !== 'object' || !run.id) return false;
  const persistedRun = loadState(root)?.active_run;
  if (!persistedRun || persistedRun.id !== run.id) return false;
  return authorizeApplicationMutation({
    root,
    filePath: 'package.json',
    run,
    eosInitialized: true,
  }).ok;
}

function buildSetupFileWrites(root, proposal) {
  const writes = [];
  if (proposal.recommendedFramework === 'vitest') {
    const configPath = 'vitest.config.ts';
    if (!fileExists(path.join(root, configPath))) {
      writes.push({
        relPath: configPath,
        content:
          "import { defineConfig } from 'vitest/config';\n\nexport default defineConfig({ test: { environment: 'node' } });\n",
      });
    }
  }
  if (proposal.recommendedFramework === 'jest') {
    const configPath = 'jest.config.js';
    if (!fileExists(path.join(root, configPath))) {
      writes.push({ relPath: configPath, content: "module.exports = { testEnvironment: 'node' };\n" });
    }
  }
  if (proposal.recommendedFramework === 'playwright') {
    const configPath = 'playwright.config.ts';
    if (!fileExists(path.join(root, configPath))) {
      writes.push({
        relPath: configPath,
        content:
          "import { defineConfig } from '@playwright/test';\n\nexport default defineConfig({ testDir: 'tests/e2e' });\n",
      });
    }
    const specPath = 'tests/e2e/smoke.spec.ts';
    if (!fileExists(path.join(root, specPath))) {
      writes.push({
        relPath: specPath,
        content:
          "import { test, expect } from '@playwright/test';\n\ntest('smoke', async ({ page }) => {\n  await page.goto('/');\n  await expect(page).toHaveTitle(/.+/);\n});\n",
        ensureDir: true,
      });
    }
  }
  if (proposal.recommendedFramework === 'pytest') {
    const iniPath = 'pytest.ini';
    if (!fileExists(path.join(root, iniPath))) {
      writes.push({ relPath: iniPath, content: '[pytest]\ntestpaths = tests\n' });
    }
  }
  const pkgPath = path.join(root, 'package.json');
  if (fileExists(pkgPath)) {
    const pkg = readJson(pkgPath) || {};
    pkg.scripts = pkg.scripts || {};
    let changed = false;
    if (proposal.kind === 'unit' && !pkg.scripts.test) {
      pkg.scripts.test = proposal.recommendedFramework === 'jest' ? 'jest' : 'vitest run';
      changed = true;
    }
    if (proposal.kind === 'e2e' && !pkg.scripts['test:e2e']) {
      pkg.scripts['test:e2e'] =
        proposal.recommendedFramework === 'cypress' ? 'cypress run' : 'playwright test';
      changed = true;
    }
    if (changed) {
      writes.push({ relPath: 'package.json', content: `${JSON.stringify(pkg, null, 2)}\n` });
    }
  }
  return writes;
}

export function stageTestCapabilitySetup(root, proposals = [], run = {}) {
  const stagingRoot = testCapabilityStagingDir(root, run.id);
  const filesDir = path.join(stagingRoot, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const staged = [];
  run.test_capability_proposals = proposals;

  for (const proposal of proposals) {
    for (const write of buildSetupFileWrites(root, proposal)) {
      const target = path.join(filesDir, write.relPath);
      if (write.ensureDir) fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, write.content);
      staged.push(write.relPath);
    }
  }

  const manifest = {
    run_id: run.id,
    staged_at: new Date().toISOString(),
    proposals,
    files: [...new Set(staged)],
  };
  fs.writeFileSync(path.join(stagingRoot, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  return {
    ok: true,
    mode: 'staged',
    written: staged.map((rel) => normalizeRel(root, path.join(stagingRoot, 'files', rel))),
    stagingRoot,
    stagedFiles: staged,
  };
}

function applySetupFileWrites(root, writes = []) {
  const written = [];
  for (const write of writes) {
    const abs = path.join(root, write.relPath);
    if (write.ensureDir) fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, write.content);
    written.push(normalizeRel(root, abs));
  }
  return written;
}

export function applyApprovedTestCapabilitySetup(root, proposals = [], options = {}) {
  const { run = null } = options;
  if (run && !isApplicationMutationPermittedForSetup(root, run)) {
    return stageTestCapabilitySetup(root, proposals, run);
  }

  const written = [];
  for (const proposal of proposals) {
    written.push(...applySetupFileWrites(root, buildSetupFileWrites(root, proposal)));
  }
  return { ok: true, mode: 'applied', written: [...new Set(written)] };
}

export function executeApprovedTestCapabilitySetup(root, proposals = [], options = {}) {
  const { run = null } = options;
  if (run && !isApplicationMutationPermittedForSetup(root, run)) {
    return stageTestCapabilitySetup(root, proposals, run);
  }

  const execFn = options.execFn || ((cmd, cwd) => execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe' }));
  const ecosystem = detectRepositoryEcosystem(root);
  const pm = ecosystem.packageManager;
  const written = [];
  const installed = [];
  const commands = [];

  for (const proposal of proposals) {
    if (proposal.recommendedFramework === 'pytest') {
      const ini = path.join(root, 'pytest.ini');
      if (!fileExists(ini)) {
        fs.writeFileSync(ini, '[pytest]\ntestpaths = tests\n');
        written.push(normalizeRel(root, ini));
      }
      continue;
    }

    const applied = applyApprovedTestCapabilitySetup(root, [proposal], options);
    if (applied.mode !== 'applied') {
      return {
        ok: false,
        written,
        installed,
        commands,
        error: 'Application mutation authorization was lost during setup.',
      };
    }
    written.push(...(applied.written || []));

    if (proposal.dependencies?.length && fileExists(path.join(root, 'package.json'))) {
      const installCmd =
        proposal.installCommand ||
        buildPackageManagerCommand(pm, 'add-dev', ...proposal.dependencies.map((d) => d.name));
      try {
        execFn(installCmd, root);
        installed.push(...proposal.dependencies.map((d) => d.name));
        commands.push(installCmd);
      } catch (err) {
        return {
          ok: false,
          written,
          installed,
          commands,
          error: err.message || 'dependency install failed',
        };
      }
    }

  }

  return { ok: true, mode: 'applied', written: [...new Set(written)], installed, commands, packageManager: pm, ecosystem };
}

export function verifyTestCapabilitySetup(root, kind, testCapabilities = {}, options = {}) {
  const run = options.run || null;
  const stagingRoot = run?.id ? testCapabilityStagingDir(root, run.id) : null;
  const manifestPath = stagingRoot ? path.join(stagingRoot, 'manifest.json') : null;
  if (!options.ignoreStaging && manifestPath && fileExists(manifestPath)) {
    const manifest = readJson(manifestPath) || {};
    const proposal = (manifest.proposals || []).find((p) => p.kind === kind);
    if (proposal) {
      for (const rel of proposal.filesToAddOrModify || []) {
        const stagedPath = path.join(stagingRoot, 'files', rel);
        if (rel === 'package.json') continue;
        if (!fileExists(stagedPath)) {
          return {
            status: SETUP_VERIFICATION.FAILED,
            kind,
            summary: `Staged setup missing file: ${rel}`,
          };
        }
      }
      return {
        status: SETUP_VERIFICATION.STAGED,
        kind,
        summary:
          'Test capability setup staged under .engineering-os — proposals verified; application apply deferred until implement phase.',
        staged: true,
      };
    }
  }

  const execFn =
    options.execFn ||
    ((cmd, cwd) => {
      execSync(cmd, { cwd, encoding: 'utf8', stdio: 'pipe', timeout: 120000 });
      return '';
    });
  const cap = kind === 'unit' ? testCapabilities.unit : testCapabilities.e2e;
  const fresh = detectTestCapabilities(root);
  const refreshed = kind === 'unit' ? fresh.unit : fresh.e2e;

  if (!cap?.runCommand && !refreshed?.runCommand) {
    return {
      status: SETUP_VERIFICATION.FAILED,
      kind,
      summary: 'No runnable test command detected after setup.',
      diagnosis: classifyTestExecutionFailure({
        name: kind,
        output: 'missing test script',
        exitCode: 1,
      }),
    };
  }

  const command = refreshed?.runCommand || cap?.runCommand;
  try {
    execFn(command, root);
    return {
      status: isAutomationAvailable(refreshed) ? SETUP_VERIFICATION.READY : SETUP_VERIFICATION.PARTIAL,
      kind,
      command,
      summary: isAutomationAvailable(refreshed)
        ? 'Test command executed successfully.'
        : 'Test command ran but capability remains partially configured.',
    };
  } catch (err) {
    const output = (err.stdout || err.stderr || err.message || '').slice(-2000);
    const diagnosis = classifyTestExecutionFailure({
      name: kind,
      output,
      exitCode: err.status ?? 1,
      command,
    });
    return {
      status: SETUP_VERIFICATION.FAILED,
      kind,
      command,
      summary: diagnosis.summary,
      diagnosis,
    };
  }
}

export function applyApprovedSetupWithVerification(root, proposals = [], run = {}, options = {}) {
  const setup = executeApprovedTestCapabilitySetup(root, proposals, { ...options, run });
  if (!setup.ok) {
    for (const proposal of proposals) {
      recordTestCapabilityDecision(run, proposal.kind, 'setup_failed');
    }
    run.test_capability_setup = setup;
    return { setup, verifications: [], failed: true };
  }

  run.test_capability_setup = setup;
  const verifications = [];
  for (const proposal of proposals) {
    const verification = verifyTestCapabilitySetup(root, proposal.kind, detectTestCapabilities(root), {
      ...options,
      run,
    });
    verifications.push(verification);
    run.test_capability_verification = run.test_capability_verification || {};
    run.test_capability_verification[proposal.kind] = verification;
    if (verification.status === SETUP_VERIFICATION.FAILED) {
      recordTestCapabilityDecision(run, proposal.kind, 'setup_failed');
    }
  }
  return {
    setup,
    verifications,
    failed: verifications.some((v) => v.status === SETUP_VERIFICATION.FAILED),
    staged: setup.mode === 'staged',
  };
}

export function applyStagedTestCapabilitySetupIfNeeded(root, run, options = {}) {
  const stagingRoot = testCapabilityStagingDir(root, run.id);
  const manifestPath = path.join(stagingRoot, 'manifest.json');
  if (!fileExists(manifestPath)) return { applied: false };
  if (!isApplicationMutationPermittedForSetup(root, run)) {
    return { applied: false, reason: 'Application mutation not permitted for staged setup apply.' };
  }

  const manifest = readJson(manifestPath) || {};
  const proposals = run.test_capability_proposals || [];
  const manifestMatchesApproval =
    manifest.run_id === run.id &&
    proposals.length > 0 &&
    JSON.stringify(manifest.proposals || []) === JSON.stringify(proposals);
  if (!manifestMatchesApproval) {
    return {
      applied: false,
      failed: true,
      reason:
        'Staged test setup manifest is missing, stale, or differs from the approved run proposal.',
    };
  }
  const setup = executeApprovedTestCapabilitySetup(root, proposals, {
    ...options,
    run,
  });
  if (!setup.ok) {
    recordSetupFailures(run, proposals, setup, []);
    return { applied: false, setup, failed: true };
  }

  const verifications = [];
  const testCapabilities = detectTestCapabilities(root);
  for (const proposal of proposals) {
    const verification = verifyTestCapabilitySetup(root, proposal.kind, testCapabilities, {
      ...options,
      run,
      ignoreStaging: true,
    });
    verifications.push(verification);
    run.test_capability_verification = run.test_capability_verification || {};
    run.test_capability_verification[proposal.kind] = verification;
  }

  const failed = verifications.some((v) => v.status !== SETUP_VERIFICATION.READY);
  if (failed) {
    recordSetupFailures(run, proposals, setup, verifications);
    return { applied: false, setup, verifications, failed: true };
  }

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  run.test_capability_setup = { ...setup, mode: 'applied', stagedAppliedAt: new Date().toISOString() };
  return { applied: true, setup, verifications };
}

function recordSetupFailures(run, proposals, setup, verifications) {
  run.workflow_decisions = run.workflow_decisions || {};
  for (const proposal of proposals) {
    const kind = proposal.kind;
    recordTestCapabilityDecision(run, kind, 'setup_failed');
    const id = `${kind}-setup-failure`;
    const existing = run.workflow_decisions[id];
    if (existing?.status === 'answered') continue;
    const verification = verifications.find((item) => item.kind === kind) || null;
    run.workflow_decisions[id] = {
      id,
      category: 'test_capability',
      question: `${kind === 'unit' ? 'Unit' : 'E2E'} setup failed verification. Choose one:`,
      impact: `Implementation remains unauthorized until ${kind} setup is retried or Manual QA fallback is explicitly selected.`,
      options: [
        {
          id: 'retry_setup',
          label: `Retry ${kind} setup`,
          description: `Re-run approved ${kind} capability setup and verification.`,
          resultingStrategy: `Retry ${kind} setup and verification.`,
        },
        {
          id: 'manual_qa',
          label: 'Explicitly fall back to Manual QA',
          description: `Accept Manual QA for ${kind} verification after setup failure.`,
          resultingStrategy: `Manual QA fallback after ${kind} setup failure.`,
        },
      ],
      status: 'pending',
      selectedOption: null,
      source: null,
      answeredAt: null,
      resultingStrategy: null,
      note: '',
      required: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      context: { verification, setup },
    };
  }
}

export function recordTestCapabilityDecision(run, kind, decision) {
  run.test_capability_decisions = run.test_capability_decisions || {};
  run.test_capability_decisions[kind] = decision;
}

export function classifyTestExecutionFailure({ name = '', output = '', exitCode = 0, command = '' } = {}) {
  if (exitCode === 0) {
    return {
      kind: null,
      summary: 'Passed',
      requiresApprovalToRepair: false,
    };
  }
  const text = `${output}\n${command}`.toLowerCase();

  const infraPatterns = [
    'enoent',
    'command not found',
    'cannot find module',
    'browser executable',
    'executable doesn',
    'econnrefused',
    'connect econnrefused',
    'port already in use',
    'timed out waiting',
    'configuration error',
    'config file',
    'missing script',
    'no test script',
    'dev server',
    'webserver',
    'authentication fixture',
    'fixture not found',
    'selenium',
    'webdriver',
  ];
  if (infraPatterns.some((p) => text.includes(p)) || exitCode === 127) {
    return {
      kind: FAILURE_CLASS.INFRASTRUCTURE,
      summary: 'Test infrastructure or environment failure — not an application assertion failure.',
      requiresApprovalToRepair: true,
    };
  }

  const appPatterns = [
    'uncaught exception',
    'unhandled rejection',
    'application error',
    '500 internal server error',
    'network error',
    'crash',
  ];
  if (appPatterns.some((p) => text.includes(p))) {
    return {
      kind: FAILURE_CLASS.APPLICATION,
      summary: 'Application defect exposed during test execution.',
      requiresApprovalToRepair: false,
    };
  }

  if (/expected|assert|assertion|toequal|tobe|not ok|fail(ed)?\s+\d+/i.test(text) || exitCode !== 0) {
    return {
      kind: FAILURE_CLASS.TEST,
      summary: 'Automated test assertions failed.',
      requiresApprovalToRepair: false,
    };
  }

  return {
    kind: FAILURE_CLASS.INFRASTRUCTURE,
    summary: 'Unable to classify failure — treat as infrastructure until verified.',
    requiresApprovalToRepair: true,
  };
}

export function enrichRunnableCommands(commands = [], testCapabilities = {}) {
  return commands.map((check) => {
    if (check.capability === 'unit-tests' && testCapabilities.unit?.runCommand) {
      return { ...check, command: testCapabilities.unit.runCommand };
    }
    if (check.capability === 'e2e-tests' && testCapabilities.e2e?.runCommand) {
      return { ...check, command: testCapabilities.e2e.runCommand };
    }
    return check;
  });
}

export function applyTestCapabilitySectionToPlan(content, section) {
  const header = '## Test Capability Assessment';
  if (content.includes(header)) {
    return content.replace(
      new RegExp(`${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n## )`),
      `${section.trim()}\n\n`
    );
  }
  const marker = content.includes('## Test Scenarios') ? '## Test Scenarios' : '## Regression Strategy';
  return content.replace(marker, `${section.trim()}\n\n${marker}`);
}
