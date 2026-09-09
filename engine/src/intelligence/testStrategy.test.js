import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decideTestStrategy,
  formatScenarioId,
  generateUnitScenarios,
  generateE2eScenarios,
  generateManualScenarios,
  parseImpactSignals,
  stripTemplateScaffolding,
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

// --- Presentation-only changes must not demand E2E (real-project regression) ---

const BOTH_CAPS = { 'unit-tests': { present: true }, 'e2e-tests': { present: true } };

test('a label/terminology change is treated as low risk and does not require E2E', () => {
  const strategy = decideTestStrategy({
    contractText:
      'Refactor the child document terminology and update the DocumentUploader component to align labels across personas',
    impactText: '',
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.equal(strategy.e2e.required, false, 'a pure terminology change must not require E2E');
  assert.equal(strategy.manual.required, true, 'manual verification still applies');
});

test('a single presentation keyword is enough to classify as low risk', () => {
  const strategy = decideTestStrategy({
    contractText: 'Rename the button label on the profile page',
    impactText: '',
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.equal(strategy.e2e.required, false);
});

test('presentation keywords never downgrade a genuinely risky change', () => {
  // high-risk keyword present alongside a label change
  const risky = decideTestStrategy({
    contractText: 'Rename the delete button label and change permission handling',
    impactText: '',
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.equal(risky.e2e.required, true, 'high-risk work still requires E2E');

  // multi-step flow present alongside a label change
  const multiStep = decideTestStrategy({
    contractText: 'Rename labels in the checkout wizard onboarding workflow',
    impactText: '',
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.equal(multiStep.e2e.required, true, 'multi-step journeys still require E2E');

  // business logic present alongside a label change
  const logic = decideTestStrategy({
    contractText: 'Rename labels and add filter logic to the store',
    impactText: '',
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.equal(logic.unit.required, true, 'business logic still requires unit tests');
});

// --- template scaffolding must not be scanned for risk keywords -------------------

const TEMPLATE_CONTRACT = `# Feature Contract

<!-- EOS_ARTIFACT_STATUS: ready-for-approval -->

- **Run ID:** feature-development-2026-01-01T00-00-00-000Z
- **Workflow:** feature-development
- **Status:** draft | ready-for-approval | approved

## Problem

__BODY__

## Acceptance Criteria

1. __BODY__

## Approval

- [ ] Human approved (\`eos gate contract-approval --approve\`)
`;

const TEMPLATE_IMPACT = `# Feature Impact Analysis

- **Run ID:** feature-development-2026-01-01T00-00-00-000Z

## Permissions / auth touchpoints

- (none detected — confirm manually)

## Routes / screens

- (none detected — confirm manually)
`;

function withBody(body) {
  return TEMPLATE_CONTRACT.split('__BODY__').join(body);
}

test('stripTemplateScaffolding removes headings, metadata and placeholders', () => {
  const stripped = stripTemplateScaffolding(TEMPLATE_IMPACT);
  assert.ok(!stripped.includes('Permissions / auth touchpoints'), 'section headings are dropped');
  assert.ok(!stripped.includes('Run ID'), 'metadata lines are dropped');
  assert.ok(!stripped.includes('none detected'), 'empty-section placeholders are dropped');
});

test('artifact scaffolding does not make a copy change look high-risk', () => {
  const strategy = decideTestStrategy({
    contractText: withBody(
      "Rename the persona label wording on the dashboard: change 'Member' to 'Player'. Pure microcopy rename, no logic change.",
    ),
    impactText: TEMPLATE_IMPACT,
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.deepEqual(strategy.signals.high_risk, [], 'the "auth touchpoints" heading is not risk evidence');
  assert.deepEqual(strategy.signals.multi_step, [], 'the "**Workflow:**" metadata line is not risk evidence');
  assert.equal(strategy.signals.has_business_logic, false, '"no logic change" is not business-logic evidence');
  assert.equal(strategy.e2e.required, false, 'a pure copy change does not require E2E');
  assert.equal(strategy.unit.required, false, 'a pure copy change does not require unit tests');
});

test('real risk in the requirement still survives scaffolding stripping', () => {
  const risky = decideTestStrategy({
    contractText: withBody('Allow a guardian to invite a member and assign a role; enforce permission checks.'),
    impactText: TEMPLATE_IMPACT,
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.ok(risky.signals.high_risk.includes('permission'), 'requirement-level risk keywords are kept');
  assert.equal(risky.e2e.required, true, 'genuinely risky work still requires E2E');

  const multiStep = decideTestStrategy({
    contractText: withBody('Build the multi-step onboarding wizard across three screens.'),
    impactText: TEMPLATE_IMPACT,
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.equal(multiStep.e2e.required, true, 'multi-step journeys still require E2E');

  const logic = decideTestStrategy({
    contractText: withBody('Calculate and sort the leaderboard standings from match results.'),
    impactText: TEMPLATE_IMPACT,
    capabilities: BOTH_CAPS,
    intake: {},
  });
  assert.equal(logic.unit.required, true, 'business logic still requires unit tests');
});
