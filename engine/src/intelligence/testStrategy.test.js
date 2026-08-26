import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideTestStrategy,
  formatScenarioId,
  generateUnitScenarios,
  generateE2eScenarios,
  generateManualScenarios,
  parseImpactSignals,
  validateVerificationPlanTestPlanning,
  applyTestStrategyToVerificationPlan,
  applyTestScenariosToPlan,
  renderTestScenariosSection,
  SCENARIO_ID_RE,
} from './testStrategy.js';
import { generateUnitTestFromScenario } from './unitTestGeneration.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

test('parseImpactSignals reads structured impact sections', () => {
  const signals = parseImpactSignals(`## Routes / screens
- \`src/pages/Home.tsx\`
- \`src/pages/Settings.tsx\`

## Shared / design-system components
- \`Button\`

## Regression areas
- checkout flow
`);
  assert.equal(signals.affected_routes_count, 2);
  assert.equal(signals.shared_component_changes, 1);
  assert.equal(signals.regression_areas_count, 0);
});

test('high risk auth feature requires unit and e2e when capabilities present', () => {
  const strategy = decideTestStrategy({
    contractText: `
## Acceptance Criteria
1. User can authenticate with organization SSO
2. Permissions are enforced on admin routes
`,
    impactText: '## Regression areas\n- routes',
    capabilities: {
      'unit-tests': { present: true, evidence: ['vitest.config.ts'] },
      'e2e-tests': { present: true, evidence: ['playwright.config.ts'] },
    },
    intake: {},
  });
  assert.equal(strategy.unit.required, true);
  assert.equal(strategy.e2e.required, true);
});

test('low risk copy change favors manual only', () => {
  const strategy = decideTestStrategy({
    contractText: 'Update button copy and spacing on landing page',
    impactText: '',
    capabilities: {
      'unit-tests': { present: true, evidence: [] },
      'e2e-tests': { present: true, evidence: [] },
    },
    intake: {},
  });
  assert.equal(strategy.unit.required, false);
  assert.equal(strategy.e2e.required, false);
  assert.equal(strategy.manual.required, true);
});

test('generateUnitScenarios from acceptance criteria uses AC-linked IDs', () => {
  const strategy = { unit: { required: true } };
  const scenarios = generateUnitScenarios({
    contractText: '## Acceptance Criteria\n1. Filter by date range\n',
    strategy,
  });
  assert.ok(scenarios.some((s) => s.startsWith('AC1-T01:')));
  assert.ok(scenarios.every((s) => SCENARIO_ID_RE.test(s.split(':')[0].trim())));
});

test('AC-linked e2e scenario generation uses AC{n}-E## IDs', () => {
  const contract = '## Acceptance Criteria\n1. Export button visible\n2. CSV download works\n';
  const strategy = { e2e: { required: true }, unit: { required: false }, manual: { required: true } };
  const scenarios = generateE2eScenarios({ contractText: contract, strategy, intake: {} });
  assert.ok(scenarios.some((s) => s.startsWith('AC1-E01:')));
});

test('manual scenario generation uses AC{n}-M## IDs', () => {
  const contract = '## Acceptance Criteria\n1. Export button visible\n2. CSV download works\n';
  const strategy = { unit: { required: false }, e2e: { required: false }, manual: { required: true } };
  const scenarios = generateManualScenarios({ contractText: contract, strategy });
  assert.deepEqual(
    scenarios.map((s) => s.split(':')[0].trim()),
    ['AC1-M01', 'AC2-M01']
  );
});

test('validateVerificationPlanTestPlanning requires AC-linked scenarios', () => {
  const contract = '## Acceptance Criteria\n1. Export button visible\n2. CSV download works\n';
  const incomplete = `# Verification Plan
## Test Strategy
Unit Tests: Not Required
E2E Tests: Not Required
Manual QA: Required
## Test Scenarios
### Manual test scenarios
- _(not required)_
## Verification matrix
| AC1: Export | x |
| AC2: CSV | x |
`;
  assert.equal(validateVerificationPlanTestPlanning(incomplete, contract).ok, false);
});

test('rewriting test scenarios does not delete regression sections', () => {
  const template = `# Verification Plan

## Test Strategy

Unit Tests: Required
E2E Tests: Not Required
Manual QA: Required

## Regression Strategy

Strategy: Automated + Manual
Automated Regression: Required
Manual QA Regression: Required

## Test Scenarios

### Unit test scenarios

- _(not required)_

## Regression Scenarios

- REG-001: changed \`src/components/TaskList.tsx\` → consumer \`src/pages/Todos.tsx\` — Existing behavior unchanged [medium risk, classification: other, automated, manual QA]

## QA Regression Scope

- Existing related behavior (REG-001)

## Test Implementation

| AC | Scenario ID | File / location | Test name / scenario covered |
`;
  const next = applyTestScenariosToPlan(
    template,
    renderTestScenariosSection(['AC1-T01: Unit happy path'], [], ['AC1-M01: Manual'])
  );
  assert.match(next, /AC1-T01/);
  assert.match(next, /REG-001/);
  assert.match(next, /QA Regression Scope/);
  assert.match(next, /Existing related behavior \(REG-001\)/);
  const strategy = applyTestStrategyToVerificationPlan(
    next,
    `## Test Strategy

Unit Tests: Required
E2E Tests: Not Required
Manual QA: Required
`
  );
  assert.match(strategy, /REG-001/);
  assert.match(strategy, /## Regression Strategy/);
});

test('formatScenarioId is deterministic', () => {
  assert.equal(formatScenarioId('AC3', 2, 'T'), 'AC3-T02');
});

test('repository-aware unit generator uses detected framework and creates a pending AC test', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-unit-gen-'));
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ type: 'module', devDependencies: { vitest: '*' } })
  );
  const generated = generateUnitTestFromScenario({
    root,
    scenario: { scenarioId: 'AC2-T01', description: 'rejects an empty export request' },
    sourceFile: 'src/export.ts',
  });
  assert.equal(generated.framework, 'vitest');
  assert.match(generated.file, /ac2-t01\.test\.ts$/);
  assert.match(generated.content, /AC2-T01/);
  assert.match(generated.content, /test\.todo/);
  assert.equal(generated.implementationStatus, 'pending');
});
