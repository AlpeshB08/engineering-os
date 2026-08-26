/**
 * Adaptive E2E capability — scenario generation, selectors, POM, debugging, evidence.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileExists } from '../paths.js';
import { FAILURE_CLASS } from './testCapabilities.js';

export const SELECTOR_PREFERENCE = [
  'data-testid',
  'data-test',
  'role',
  'aria-label',
  'label',
  'placeholder',
  'text',
  'css',
];

const BRITTLE_SELECTOR_PATTERNS = [
  /\.css-[a-z0-9]+/i,
  /nth-child/i,
  /:nth-/i,
  />\s*div\s*>\s*div/i,
];

export function preferStableSelector({ testId, role, name, label, text, fallback } = {}) {
  if (testId) return `[data-testid="${testId}"]`;
  if (role && name) return `role=${role}[name="${name}"]`;
  if (label) return `label=${label}`;
  if (text) return `text=${text}`;
  return fallback || 'getByRole("button")';
}

export function isBrittleSelector(selector = '') {
  return BRITTLE_SELECTOR_PATTERNS.some((p) => p.test(selector));
}

export function shouldUsePageObjectModel(testCapabilities = {}, { flowCount = 1, repeatedPage = false } = {}) {
  const pom = testCapabilities.e2e?.pageObjects || testCapabilities.browser?.pageObjects;
  if (pom?.status === 'available' && pom.pattern === 'page-object-model') {
    return { use: true, reason: 'Repository already organizes E2E tests with Page Objects.' };
  }
  if (pom?.status === 'available' && pom.pattern === 'inline/spec') {
    return { use: false, reason: 'Follow existing inline/spec E2E organization.' };
  }
  if (repeatedPage && flowCount >= 2) {
    return { use: true, reason: 'Repeated page interactions justify a small Page Object.' };
  }
  return { use: false, reason: 'Single-flow E2E — inline test is sufficient (YAGNI).' };
}

export function generatePageObjectStub({ pageName, actions = [] }) {
  const className = `${pageName.replace(/[^a-zA-Z0-9]/g, '')}Page`;
  const methods = actions
    .map((a) => `  async ${a.name}() {\n    // ${a.description || a.name}\n  }`)
    .join('\n\n');
  return `export class ${className} {\n  constructor(page) {\n    this.page = page;\n  }\n\n${methods}\n}\n`;
}

export function parseScenarioBullet(text = '') {
  const idMatch = text.match(/\b(AC\d+-E\d+)\b/i);
  const descMatch = text.match(/:\s*(.+)$/);
  return {
    scenarioId: idMatch ? idMatch[1].toUpperCase() : null,
    acId: idMatch ? idMatch[1].split('-')[0].toUpperCase() : null,
    description: descMatch?.[1]?.trim() || text,
  };
}

export function generateE2eTestFromScenario({
  scenario = {},
  testCapabilities = {},
  runId = '',
  targetPath = '',
} = {}) {
  if (!scenario.scenarioId || !/^AC\d+-E\d+$/i.test(scenario.scenarioId)) {
    throw new Error('E2E generation requires an AC{n}-E## feature scenario.');
  }
  const framework = testCapabilities.e2e?.framework || 'playwright';
  const pomDecision = shouldUsePageObjectModel(testCapabilities, {
    flowCount: 1,
    repeatedPage: /flow|journey|wizard/i.test(scenario.description || ''),
  });
  const featureSlug = String(scenario.testId || scenario.description || scenario.scenarioId)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
  const route = scenario.route || '/';
  const selector = preferStableSelector({
    testId: scenario.testId || featureSlug,
    role: scenario.role,
    name: scenario.accessibleName,
  });
  const fileName = targetPath || `tests/e2e/${(scenario.scenarioId || 'scenario').toLowerCase()}.spec.ts`;
  const testName = `${scenario.scenarioId}: ${scenario.description}`;

  if (framework === 'cypress') {
    return {
      framework,
      file: fileName.replace(/\.ts$/, '.cy.ts'),
      testName,
      purpose: 'acceptance-criterion',
      content: `// ${scenario.scenarioId}: ${scenario.description}\n// Run ID: ${runId}\n\ndescribe('${scenario.scenarioId}', () => {\n  it('${scenario.description}', () => {\n    cy.visit('${route}');\n    cy.get('[data-testid="${scenario.testId || featureSlug}"]').should('exist');\n  });\n});\n`,
      pom: pomDecision,
      selectors: [selector],
    };
  }

  const pomImport = pomDecision.use ? `\nimport { FeaturePage } from './pages/FeaturePage.js';\n` : '';
  const body = pomDecision.use
    ? `  const pageObj = new FeaturePage(page);\n  await pageObj.open();\n  await pageObj.completeFlow();\n  await expect(page.getByTestId('${scenario.testId || featureSlug}')).toBeVisible();`
    : `  await page.goto('${route}');\n  await expect(page.locator('${selector}')).toBeVisible();`;

  return {
    framework,
    file: fileName,
    testName,
    purpose: 'acceptance-criterion',
    content:
      `// ${scenario.scenarioId}: ${scenario.description}\n// Run ID: ${runId}\nimport { test, expect } from '@playwright/test';${pomImport}\n\ntest('${testName}', async ({ page }) => {\n${body}\n});\n`,
    pom: pomDecision,
    selectors: [selector],
  };
}

export function buildE2eExplorationGuide(testCapabilities = {}, intake = {}) {
  const devServer = testCapabilities.devServer?.command || '(dev server not detected)';
  return {
    launch: testCapabilities.e2e?.runCommand || null,
    devServer,
    authFixtures: testCapabilities.authFixtures?.paths || [],
    figma: intake?.figma?.url || null,
    steps: [
      'Launch dev server or use configured webServer in E2E config',
      'Navigate primary user flows from approved scenarios',
      'Identify stable selectors (data-testid, roles, labels) — avoid generated CSS classes',
      'Record baseline behavior before generating executable tests',
      'Do not perform destructive actions outside approved test scope',
    ],
  };
}

export function diagnoseE2eFailure({ output = '', failureClass = null, testFile = '' } = {}) {
  const text = output.toLowerCase();
  if (failureClass === FAILURE_CLASS.INFRASTRUCTURE || /cannot find module|browser executable|econnrefused/.test(text)) {
    return {
      category: 'infrastructure',
      summary: 'Environment or browser infrastructure failure',
      testOnlyFixAllowed: false,
      suggestedAction: 'Verify dev server, browser install, and fixtures before changing tests.',
    };
  }
  if (/timeout|waiting for selector|locator/.test(text)) {
    return {
      category: 'selector',
      summary: 'Selector or timing issue in E2E test',
      testOnlyFixAllowed: true,
      suggestedAction: 'Prefer stable selector or explicit wait in test code only.',
    };
  }
  if (failureClass === FAILURE_CLASS.APPLICATION) {
    return {
      category: 'application',
      summary: 'Application defect — do not modify app code autonomously',
      testOnlyFixAllowed: false,
      suggestedAction: 'Report via existing /feature implementation workflow.',
    };
  }
  return {
    category: 'assertion',
    summary: 'Test assertion failure',
    testOnlyFixAllowed: true,
    suggestedAction: 'Review expected behavior against contract; adjust test assertions if spec was wrong.',
  };
}

export function applyLimitedE2eTestFix({ testContent = '', diagnosis = {} } = {}) {
  if (!diagnosis.testOnlyFixAllowed) {
    return { applied: false, content: testContent, reason: diagnosis.summary };
  }
  if (diagnosis.category === 'selector' && !testContent.includes('getByTestId')) {
    return {
      applied: true,
      content: testContent.replace(
        /locator\([^)]+\)/,
        "getByTestId('feature-action')"
      ),
      reason: 'Replaced brittle locator with stable data-testid selector (test-only change).',
    };
  }
  return { applied: false, content: testContent, reason: 'No safe automated test-only fix identified.' };
}

export function renderE2eAutomationSection({ scenarios = [], testCapabilities = {}, runId = '', intake = {} }) {
  if (!testCapabilities.e2e || testCapabilities.e2e.status !== 'available') {
    return '';
  }
  const guide = buildE2eExplorationGuide(testCapabilities, intake);
  const generated = scenarios
    .filter((s) => s.type === 'e2e' || /-E\d+/i.test(s.scenarioId || ''))
    .slice(0, 8)
    .map((s) => {
      const spec = generateE2eTestFromScenario({ scenario: s, testCapabilities, runId });
      return `- ${s.scenarioId || s.description}: \`${spec.file}\` (${spec.pom.use ? 'POM' : 'inline'})`;
    });

  return `## E2E Automation

Browser command: ${guide.launch || '—'}
Dev server: ${guide.devServer}
Auth fixtures: ${guide.authFixtures.join(', ') || '—'}

### Exploration steps

${guide.steps.map((s) => `- ${s}`).join('\n')}

### Generated E2E targets

${generated.length ? generated.join('\n') : '- _(generate during implement from AC{n}-E## scenarios)_'}
`;
}

export function renderE2eExecutionEvidenceBlock({ runId = '', results = [] } = {}) {
  if (!results.length) return '';
  const lines = results.map(
    (r) =>
      `| ${r.scenarioId || '—'} | ${r.file || '—'} | ${r.status} | ${r.failureSummary || '—'} | ${runId} |`
  );
  return `## E2E execution evidence

| Scenario | Test file | Status | Notes | Run ID |
|----------|-----------|--------|-------|--------|
${lines.join('\n')}
`;
}

export function writeE2eTestFile(root, spec) {
  if (!spec?.file || !spec.content) return null;
  const full = path.join(root, spec.file);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (!fileExists(full)) {
    fs.writeFileSync(full, spec.content);
    return spec.file;
  }
  return null;
}
