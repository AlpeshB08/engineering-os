import fs from 'node:fs';
import path from 'node:path';

function readPackage(root) {
  try {
    return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  } catch {
    return {};
  }
}

function detectFramework(root, testCapabilities = {}) {
  const explicit = String(testCapabilities.unit?.framework || '').toLowerCase();
  if (explicit) return explicit;
  const pkg = readPackage(root);
  const dependencies = { ...pkg.dependencies, ...pkg.devDependencies };
  if (dependencies.vitest) return 'vitest';
  if (dependencies.jest) return 'jest';
  if (dependencies.mocha) return 'mocha';
  return 'node:test';
}

function preferredExtension(root, sourceFile = '') {
  if (/\.(ts|tsx)$/i.test(sourceFile)) return 'ts';
  const pkg = readPackage(root);
  return pkg.type === 'module' ? 'js' : 'cjs';
}

export function generateUnitTestFromScenario({
  root = '',
  scenario = {},
  testCapabilities = {},
  sourceFile = '',
  targetPath = '',
} = {}) {
  if (!scenario.scenarioId || !/^AC\d+-T\d+$/i.test(scenario.scenarioId)) {
    throw new Error('Unit test generation requires an AC{n}-T## scenario ID.');
  }
  const framework = detectFramework(root, testCapabilities);
  const extension = preferredExtension(root, sourceFile);
  const file =
    targetPath ||
    `tests/unit/${scenario.scenarioId.toLowerCase()}.test.${extension}`;
  const testName = `${scenario.scenarioId}: ${String(scenario.description || '').trim()}`;
  const escapedName = testName.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  const importLine =
    framework === 'vitest'
      ? "import { test } from 'vitest';"
      : framework === 'jest'
        ? ''
        : framework === 'mocha'
          ? ''
          : "import test from 'node:test';";
  const todo =
    framework === 'mocha'
      ? `it.skip('${escapedName}', function () {\n  // TODO: implement this AC scenario against ${sourceFile || 'the feature module'}.\n});`
      : `test.todo('${escapedName}');`;

  return {
    framework,
    file,
    testName,
    scenarioId: scenario.scenarioId.toUpperCase(),
    sourceFile: sourceFile || null,
    content: `// ${scenario.scenarioId}: ${scenario.description || ''}\n${importLine}${importLine ? '\n\n' : ''}${todo}\n`,
    implementationStatus: 'pending',
  };
}

