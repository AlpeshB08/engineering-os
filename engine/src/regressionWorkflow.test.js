import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validatePlanBundle, artifactPath } from './artifacts.js';
import { validateVerificationPlanTestPlanning } from './intelligence/testStrategy.js';
import {
  buildRegressionImpact,
  decideRegressionStrategy,
  formatRegId,
  generateRegressionScenarios,
  generateQaRegressionScope,
  renderRegressionScenariosSection,
  parseRegressionScenariosFromPlan,
  parseRegressionStrategyFromPlan,
  REG_SCENARIO_ID_RE,
  validateRegressionPlanPlanning,
} from './intelligence/regressionImpact.js';
import { parseTestScenarios } from './requirementVerification.js';
import {
  buildRegressionCoverage,
  regressionGateSatisfied,
} from './regressionVerification.js';
import { computeFinalStatus } from './verify.js';
import { parseTestStrategy } from './requirementVerification.js';
import { buildRequirementCoverage } from './requirementVerification.js';
import {
  readyFixtures,
  regressionRequiredFixtures,
  writeFixtureBundle,
} from '../test/fixtures/verifyFixtures.js';
import { scanRepository } from './intelligence/scan.js';
import { runIntelScan } from './intelligence/dna.js';
import { generateGraphs } from './intelligence/graphs.js';
import { frameworkHome } from './paths.js';

const baseRun = {
  id: 'run-current',
  blocked: false,
  gates: {
    'plan-approval': { status: 'approved', run_id: 'run-current' },
    'contract-approval': { status: 'approved', run_id: 'run-current' },
  },
  completed_phases: ['implement'],
  orchestration: { blockers: [] },
};

function makeSharedComponentFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-reg-'));
  fs.mkdirSync(path.join(dir, 'src/components/ui'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/pages'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ dependencies: { react: '19' } }));
  fs.writeFileSync(path.join(dir, 'src/components/ui/Button.tsx'), 'export const Button = () => null;\n');
  fs.writeFileSync(
    path.join(dir, 'src/components/UserCard.tsx'),
    "import { Button } from '@/components/ui/Button';\nexport const UserCard = () => <Button />;\n"
  );
  fs.writeFileSync(
    path.join(dir, 'src/pages/UsersPage.tsx'),
    "import { UserCard } from '@/components/UserCard';\nexport default function UsersPage(){ return <UserCard/> }\n"
  );
  fs.mkdirSync(path.join(dir, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.engineering-os', 'state.json'),
    JSON.stringify({ version: 1, initialized_at: new Date().toISOString(), capabilities: {}, archetype: 'frontend', active_run: null })
  );
  runIntelScan(dir, frameworkHome());
  generateGraphs(dir);
  return dir;
}

test('REG ID generation uses REG-### format', () => {
  assert.equal(formatRegId(1), 'REG-001');
  assert.equal(formatRegId(12), 'REG-012');
  assert.ok(REG_SCENARIO_ID_RE.test('REG-001'));
});

test('REG IDs are deterministic for the same candidate set', () => {
  const impact = {
    candidates: [
      { changedPath: 'a', consumerPath: 'b', consumerKind: 'components', flow: 'flow b', risk: 'medium' },
      { changedPath: 'a', consumerPath: 'c', consumerKind: 'routes', flow: 'flow c', risk: 'high' },
    ],
  };
  const strategy = { required: true, automated: { required: true }, manual: { required: true } };
  const first = generateRegressionScenarios({ regressionImpact: impact, regressionStrategy: strategy });
  const second = generateRegressionScenarios({ regressionImpact: impact, regressionStrategy: strategy });
  assert.deepEqual(
    first.map((s) => s.regId),
    ['REG-001', 'REG-002']
  );
  assert.deepEqual(first.map((s) => s.regId), second.map((s) => s.regId));
});

test('graph-based blast radius detects shared component consumers', () => {
  const dir = makeSharedComponentFixture();
  const dna = scanRepository(dir);
  const impact = {
    hits: {
      shared_components: ['src/components/ui/Button.tsx'],
      components: [],
      regression_areas: [],
    },
  };
  const regressionImpact = buildRegressionImpact(dir, impact);
  assert.ok(regressionImpact.candidates.length >= 1);
  assert.ok(regressionImpact.candidates.some((c) => c.consumerPath.includes('UserCard') || c.consumerPath.includes('UsersPage')));
});

test('feature and regression scenarios remain separate', () => {
  const plan = readyFixtures('run-1')['verification-plan.md'];
  const feature = parseTestScenarios(plan);
  const regression = parseRegressionScenariosFromPlan(plan);
  assert.ok(feature.every((s) => !/^REG-/i.test(s.scenarioId || '')));
  assert.ok(regression.every((s) => REG_SCENARIO_ID_RE.test(s.regId)));
});

test('missing regression scenarios block approval when regression required', () => {
  const plan = readyFixtures('run-1')['verification-plan.md'].replace(
    'Strategy: Not Required',
    'Strategy: Manual only'
  ).replace('Automated Regression: Not Required', 'Automated Regression: Not Required')
    .replace('Manual QA Regression: Not Required', 'Manual QA Regression: Required');
  const result = validateRegressionPlanPlanning(plan);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes('no REG scenarios')));
});

test('required regression scenario must declare risk and classification', () => {
  const plan = `# Verification Plan
## Regression Strategy
Strategy: Manual only
Automated Regression: Not Required
Manual QA Regression: Required
## Regression Scenarios
- REG-001: Existing checkout remains stable
## QA Regression Scope
- Checkout flow (REG-001)
`;
  const result = validateRegressionPlanPlanning(plan);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => /risk classification/.test(issue)));
  assert.ok(result.issues.some((issue) => /regression classification/.test(issue)));
});

test('regression Not Required does not block approval', () => {
  const plan = readyFixtures('run-1')['verification-plan.md'];
  const contract = readyFixtures('run-1')['feature-contract.md'];
  const result = validateVerificationPlanTestPlanning(plan, contract);
  assert.equal(result.ok, true);
  assert.equal(parseRegressionStrategyFromPlan(plan).required, false);
});

test('missing regression implementation yields NOT READY', () => {
  const fixtures = regressionRequiredFixtures('run-current');
  const plan = fixtures['verification-plan.md'].replace(
    '| REG-001 | tests/regression/button-users.spec.ts | e2e | implemented |',
    '| REG-001 | | e2e | pending |'
  );
  const coverage = buildRegressionCoverage({
    planText: plan,
    evidenceText: fixtures['verification-evidence.md'],
    runId: 'run-current',
  });
  const gate = regressionGateSatisfied(coverage, parseRegressionStrategyFromPlan(plan));
  assert.equal(gate.ok, false);
});

test('missing regression execution yields NOT READY', () => {
  const fixtures = regressionRequiredFixtures('run-current');
  const evidence = fixtures['verification-evidence.md'].replace(
    /## Regression execution evidence[\s\S]*/m,
    '## Regression execution evidence\n\n| REG ID | Test reference | Current Run ID | Status | Evidence / notes |\n|--------|----------------|----------------|--------|------------------|\n'
  );
  const gate = regressionGateSatisfied(
    buildRegressionCoverage({
      planText: fixtures['verification-plan.md'],
      evidenceText: evidence,
      runId: 'run-current',
    }),
    parseRegressionStrategyFromPlan(fixtures['verification-plan.md'])
  );
  assert.equal(gate.ok, false);
});

test('stale regression evidence yields NOT READY', () => {
  const fixtures = regressionRequiredFixtures('run-current');
  const evidence = fixtures['verification-evidence.md'].replace(/run-regression-1/g, 'run-previous');
  const gate = regressionGateSatisfied(
    buildRegressionCoverage({
      planText: fixtures['verification-plan.md'],
      evidenceText: evidence,
      runId: 'run-regression-1',
    }),
    parseRegressionStrategyFromPlan(fixtures['verification-plan.md'])
  );
  assert.equal(gate.ok, false);
});

test('failed regression yields NOT READY', () => {
  const fixtures = regressionRequiredFixtures('run-current');
  const evidence = fixtures['verification-evidence.md'].replace('| Passed |', '| Failed |');
  const gate = regressionGateSatisfied(
    buildRegressionCoverage({
      planText: fixtures['verification-plan.md'],
      evidenceText: evidence,
      runId: 'run-regression-1',
    }),
    parseRegressionStrategyFromPlan(fixtures['verification-plan.md'])
  );
  assert.equal(gate.ok, false);
});

test('passed regression with AC chain can reach READY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-reg-ready-'));
  writeFixtureBundle(dir, 'ready-reg', {
    runId: 'run-regression-1',
    overrides: regressionRequiredFixtures('run-regression-1'),
  });
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-regression-1');
  const plan = fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8');
  const evidence = fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8');
  const coverage = buildRequirementCoverage({
    contractText: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    planText: plan,
    evidenceText: evidence,
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    strategy: parseTestStrategy(plan),
    consumerRoot: dir,
    runId: 'run-regression-1',
  });
  const { status, reasons } = computeFinalStatus({
    run: {
      ...baseRun,
      id: 'run-regression-1',
      gates: {
        'plan-approval': { status: 'approved', run_id: 'run-regression-1' },
        'contract-approval': { status: 'approved', run_id: 'run-regression-1' },
      },
    },
    coverage,
    strategy: parseTestStrategy(plan),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence,
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
    plan,
  });
  assert.equal(status, 'READY FOR REVIEW', reasons.join('; '));
});

test('QA regression scope required when manual regression required', () => {
  const plan = `# Verification Plan
## Regression Strategy
Strategy: Manual only
Automated Regression: Not Required
Manual QA Regression: Required
## Regression Scenarios
- REG-001: changed \`a\` → consumer \`b\` — Existing behavior unchanged [medium risk, manual QA]
## QA Regression Scope
- _(not required)_
`;
  const result = validateRegressionPlanPlanning(plan);
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((i) => i.includes('QA Regression Scope')));
});

test('low-risk feature with regression Not Required stays READY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-reg-low-'));
  writeFixtureBundle(dir, 'low', { runId: 'run-current', overrides: readyFixtures('run-current') });
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-current');
  const plan = fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8');
  const evidence = fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8');
  const coverage = buildRequirementCoverage({
    contractText: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    planText: plan,
    evidenceText: evidence,
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    strategy: parseTestStrategy(plan),
    consumerRoot: dir,
    runId: 'run-current',
  });
  const { status } = computeFinalStatus({
    run: baseRun,
    coverage,
    strategy: parseTestStrategy(plan),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence,
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
    plan,
  });
  assert.equal(status, 'READY FOR REVIEW');
});

test('QA scope items trace to REG IDs', () => {
  const scenarios = [
    { regId: 'REG-001', flow: 'Existing membership purchase flow' },
    { regId: 'REG-002', flow: 'Existing cancellation behavior' },
  ];
  const scope = generateQaRegressionScope({
    regressionScenarios: scenarios,
    regressionStrategy: { required: true, manual: { required: true } },
  });
  assert.ok(scope.every((s) => s.regId && s.label.includes(s.regId)));
});

test('shared component with multiple consumers generates multiple REG scenarios', () => {
  const dir = makeSharedComponentFixture();
  const impact = {
    hits: { shared_components: ['src/components/ui/Button.tsx'], components: [], regression_areas: [] },
  };
  const regressionImpact = buildRegressionImpact(dir, impact);
  const strategy = decideRegressionStrategy({
    regressionImpact,
    capabilities: { 'e2e-tests': { present: true }, 'unit-tests': { present: true } },
    featureStrategy: { signals: { shared_component_changes: 1 } },
  });
  const scenarios = generateRegressionScenarios({ regressionImpact, regressionStrategy: strategy });
  assert.ok(scenarios.length >= 2);
});

test('required regression with no graph candidates still generates REG scenarios', () => {
  const scenarios = generateRegressionScenarios({
    regressionImpact: { candidates: [], changedPaths: ['src/components/TaskList.tsx'] },
    regressionStrategy: {
      required: true,
      automated: { required: true },
      manual: { required: true },
    },
  });
  assert.ok(scenarios.length >= 1);
  assert.match(scenarios[0].regId, /^REG-\d{3}$/);
  assert.ok(scenarios[0].manual);
  const section = renderRegressionScenariosSection(scenarios, { required: true });
  assert.match(section, /classification:/);
});

test('decideRegressionStrategy marks isolated changes as Not Required', () => {
  const strategy = decideRegressionStrategy({
    regressionImpact: { candidates: [] },
    capabilities: {},
    featureStrategy: { signals: {} },
  });
  assert.equal(strategy.required, false);
  assert.equal(strategy.label, 'Not Required');
});
