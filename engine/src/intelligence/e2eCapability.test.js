import test from 'node:test';
import assert from 'node:assert/strict';
import {
  preferStableSelector,
  isBrittleSelector,
  shouldUsePageObjectModel,
  generateE2eTestFromScenario,
  buildE2eExplorationGuide,
  diagnoseE2eFailure,
  applyLimitedE2eTestFix,
  renderE2eExecutionEvidenceBlock,
} from './e2eCapability.js';
import { CAPABILITY_STATUS, FAILURE_CLASS } from './testCapabilities.js';

test('stable selectors are preferred over brittle CSS', () => {
  const selector = preferStableSelector({ testId: 'submit-btn', fallback: '.css-abc123' });
  assert.equal(selector, '[data-testid="submit-btn"]');
  assert.equal(isBrittleSelector('.css-abc123'), true);
  assert.equal(isBrittleSelector('[data-testid="x"]'), false);
});

test('POM is reused when repository already uses page objects', () => {
  const decision = shouldUsePageObjectModel({
    e2e: { pageObjects: { status: CAPABILITY_STATUS.AVAILABLE, pattern: 'page-object-model' } },
  });
  assert.equal(decision.use, true);
});

test('POM is not introduced for single inline flow', () => {
  const decision = shouldUsePageObjectModel({ e2e: { pageObjects: { status: CAPABILITY_STATUS.UNAVAILABLE } } });
  assert.equal(decision.use, false);
});

test('scenario generates executable E2E test with stable selector', () => {
  const spec = generateE2eTestFromScenario({
    scenario: { scenarioId: 'AC1-E01', description: 'User completes flow' },
    testCapabilities: { e2e: { framework: 'playwright', status: CAPABILITY_STATUS.AVAILABLE } },
    runId: 'run-1',
  });
  assert.match(spec.content, /AC1-E01/);
  assert.match(spec.content, /getByTestId|data-testid/);
  assert.equal(spec.purpose, 'acceptance-criterion');
  assert.match(spec.testName, /User completes flow/);
  assert.doesNotMatch(spec.testName, /^smoke$/i);
});

test('browser exploration guide includes dev server and non-destructive steps', () => {
  const guide = buildE2eExplorationGuide(
    { e2e: { runCommand: 'pnpm run test:e2e' }, devServer: { command: 'pnpm run dev' } },
    {}
  );
  assert.ok(guide.steps.some((s) => /destructive/i.test(s)));
  assert.equal(guide.launch, 'pnpm run test:e2e');
});

test('infrastructure failure is distinguished from test failure', () => {
  const infra = diagnoseE2eFailure({
    output: 'browser executable not found',
    failureClass: FAILURE_CLASS.INFRASTRUCTURE,
  });
  const testFail = diagnoseE2eFailure({ output: 'Expected visible', failureClass: FAILURE_CLASS.TEST });
  assert.equal(infra.testOnlyFixAllowed, false);
  assert.equal(testFail.testOnlyFixAllowed, true);
});

test('limited debugging does not modify application behavior', () => {
  const diagnosis = diagnoseE2eFailure({
    output: '500 internal server error uncaught exception',
    failureClass: FAILURE_CLASS.APPLICATION,
  });
  const fix = applyLimitedE2eTestFix({ testContent: 'await page.click()', diagnosis });
  assert.equal(fix.applied, false);
});

test('execution evidence captures current run ID', () => {
  const block = renderE2eExecutionEvidenceBlock({
    runId: 'run-current',
    results: [{ scenarioId: 'AC1-E01', file: 'tests/e2e/ac1.spec.ts', status: 'Passed' }],
  });
  assert.match(block, /run-current/);
  assert.match(block, /AC1-E01/);
});
