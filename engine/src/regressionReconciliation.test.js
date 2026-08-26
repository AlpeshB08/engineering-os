import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runIntelScan } from './intelligence/dna.js';
import { generateGraphs } from './intelligence/graphs.js';
import { frameworkHome } from './paths.js';
import {
  reconcileRegressionImpact,
  runPostImplementationRegressionReconciliation,
  parseReconciledRegIdsFromEvidence,
  applyReconciliationToEvidence,
} from './intelligence/regressionReconciliation.js';
import { formatRegId } from './intelligence/regressionImpact.js';
import { buildRegressionCoverage, regressionGateSatisfied } from './regressionVerification.js';
import { parseRegressionStrategyFromPlan } from './intelligence/regressionImpact.js';
import { computeFinalStatus } from './verify.js';
import { parseTestStrategy, buildRequirementCoverage } from './requirementVerification.js';
import {
  readyFixtures,
  regressionRequiredFixtures,
  writeFixtureBundle,
} from '../test/fixtures/verifyFixtures.js';

function makeSharedComponentFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-reconcile-'));
  fs.mkdirSync(path.join(dir, 'src/components/ui'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/pages'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'src/components'), { recursive: true });
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
  fs.writeFileSync(
    path.join(dir, 'src/pages/TeamDetails.tsx'),
    "import { Button } from '@/components/ui/Button';\nexport default function TeamDetails(){ return <Button/> }\n"
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

const regressionStrategy = {
  required: true,
  automatedRequired: true,
  manualRequired: true,
  label: 'Automated + Manual',
};

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

test('planned impact matches actual diff keeps stable REG IDs', () => {
  const dir = makeSharedComponentFixture();
  const planned = [
    {
      regId: 'REG-001',
      changedPath: 'src/components/ui/Button.tsx',
      consumerPath: 'src/pages/UsersPage.tsx',
      flow: 'UI flow using `src/pages/UsersPage.tsx`',
      priority: 'high',
      automated: true,
      manual: true,
    },
    {
      regId: 'REG-002',
      changedPath: 'src/components/ui/Button.tsx',
      consumerPath: 'src/components/UserCard.tsx',
      flow: 'UI flow using `src/components/UserCard.tsx`',
      priority: 'medium',
      automated: true,
      manual: true,
    },
    {
      regId: 'REG-003',
      changedPath: 'src/components/ui/Button.tsx',
      consumerPath: 'src/pages/TeamDetails.tsx',
      flow: 'UI flow using `src/pages/TeamDetails.tsx`',
      priority: 'medium',
      automated: true,
      manual: true,
    },
  ];
  const result = reconcileRegressionImpact({
    root: dir,
    plannedScenarios: planned,
    changedFiles: ['src/components/ui/Button.tsx'],
    regressionStrategy,
  });
  assert.deepEqual(
    result.reconciledScenarios.map((s) => s.regId).sort(),
    ['REG-001', 'REG-002', 'REG-003']
  );
  assert.equal(result.newlyDiscovered.length, 0);
});

test('actual shared component introduces a new consumer with deterministic REG ID', () => {
  const dir = makeSharedComponentFixture();
  const planned = [
    {
      regId: 'REG-001',
      changedPath: 'src/components/ui/Button.tsx',
      consumerPath: 'src/pages/UsersPage.tsx',
      priority: 'high',
      automated: true,
      manual: true,
    },
    {
      regId: 'REG-002',
      changedPath: 'src/components/ui/Button.tsx',
      consumerPath: 'src/components/UserCard.tsx',
      priority: 'medium',
      automated: true,
      manual: true,
    },
  ];
  const result = reconcileRegressionImpact({
    root: dir,
    plannedScenarios: planned,
    changedFiles: ['src/components/ui/Button.tsx'],
    regressionStrategy,
  });
  const newScenario = result.newlyDiscovered.find((s) => s.consumerPath.includes('TeamDetails'));
  assert.ok(newScenario);
  assert.equal(newScenario.regId, 'REG-003');
});

test('existing REG IDs remain stable when still relevant', () => {
  const dir = makeSharedComponentFixture();
  const planned = [
    {
      regId: 'REG-001',
      changedPath: 'src/components/ui/Button.tsx',
      consumerPath: 'src/pages/UsersPage.tsx',
      priority: 'high',
      automated: true,
      manual: true,
    },
  ];
  const first = reconcileRegressionImpact({
    root: dir,
    plannedScenarios: planned,
    changedFiles: ['src/components/ui/Button.tsx'],
    regressionStrategy,
  });
  const second = reconcileRegressionImpact({
    root: dir,
    plannedScenarios: planned,
    changedFiles: ['src/components/ui/Button.tsx'],
    regressionStrategy,
  });
  assert.deepEqual(
    first.reconciledScenarios.map((s) => s.regId),
    second.reconciledScenarios.map((s) => s.regId)
  );
});

test('low-risk changed files do not create unnecessary REG scenarios', () => {
  const dir = makeSharedComponentFixture();
  const result = reconcileRegressionImpact({
    root: dir,
    plannedScenarios: [],
    changedFiles: ['README.md', 'docs/notes.md'],
    regressionStrategy,
  });
  assert.equal(result.newlyDiscovered.length, 0);
  assert.equal(result.reconciledScenarios.length, 0);
});

test('newly discovered REG scenario blocks READY until verified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-reconcile-ready-'));
  const fixtures = regressionRequiredFixtures('run-regression-1');
  let plan = fixtures['verification-plan.md'].replace(
    /## Regression Scenarios[\s\S]*?(?=\n## QA Regression Scope)/,
    `## Regression Scenarios

- REG-001: changed \`src/components/ui/Button.tsx\` → consumer \`src/pages/UsersPage.tsx\` — Existing behavior unchanged [high risk, automated, manual QA]
- REG-002: changed \`src/components/ui/Button.tsx\` → consumer \`src/components/UserCard.tsx\` — Existing behavior unchanged [medium risk, automated, manual QA]
- REG-003: changed \`src/components/ui/Button.tsx\` → consumer \`src/pages/TeamDetails.tsx\` — Existing behavior unchanged [medium risk, automated, manual QA]

`
  );
  plan = plan.replace(
    '## Verification matrix',
    `## Regression Test Implementation

| REG ID | Test File / Reference | Test Type | Status |
|--------|----------------------|-----------|--------|
| REG-001 | tests/regression/button-users.spec.ts | e2e | implemented |
| REG-002 | tests/regression/button-card.spec.ts | e2e | implemented |
| REG-003 | | e2e | pending |

## Verification matrix`
  );
  const reconciledEvidence = applyReconciliationToEvidence(fixtures['verification-evidence.md'], {
    reconciledRegIds: ['REG-001', 'REG-002', 'REG-003'],
    changedFiles: ['src/components/ui/Button.tsx'],
    actualImpact: { highImpactFiles: ['src/components/ui/Button.tsx'] },
    newlyDiscovered: [{ regId: 'REG-003' }],
    rows: [],
    reconciledScenarios: [{ regId: 'REG-001' }, { regId: 'REG-002' }, { regId: 'REG-003' }],
  });
  writeFixtureBundle(dir, 'reconcile-block', {
    runId: 'run-regression-1',
    overrides: { ...fixtures, 'verification-plan.md': plan, 'verification-evidence.md': reconciledEvidence },
  });
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-regression-1');
  const coverage = buildRequirementCoverage({
    contractText: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    planText: fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8'),
    evidenceText: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    strategy: parseTestStrategy(plan),
    consumerRoot: dir,
    runId: 'run-regression-1',
  });
  const { status } = computeFinalStatus({
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
    evidence: reconciledEvidence,
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
    plan,
  });
  assert.equal(status, 'IMPLEMENTED_BUT_VERIFICATION_PENDING');
});

test('QA scope includes newly discovered regression areas', () => {
  const dir = makeSharedComponentFixture();
  const planned = [
    {
      regId: 'REG-001',
      changedPath: 'src/components/ui/Button.tsx',
      consumerPath: 'src/pages/UsersPage.tsx',
      flow: 'UI flow using `src/pages/UsersPage.tsx`',
      expectedBehavior: 'Existing behavior unchanged',
      priority: 'high',
      automated: true,
      manual: true,
    },
  ];
  const result = reconcileRegressionImpact({
    root: dir,
    plannedScenarios: planned,
    changedFiles: ['src/components/ui/Button.tsx'],
    regressionStrategy,
  });
  assert.ok(result.qaScope.some((q) => /TeamDetails/.test(q.label)));
  assert.ok(result.qaScope.length >= 1);
  assert.ok(result.reconciledScenarios.some((s) => s.consumerPath.includes('TeamDetails')));
});

test('Regression Not Required preserves existing behavior', () => {
  const dir = makeSharedComponentFixture();
  const plan = readyFixtures('run-1')['verification-plan.md'];
  const strategy = parseRegressionStrategyFromPlan(plan);
  const result = runPostImplementationRegressionReconciliation({
    root: dir,
    planText: plan,
    run: {},
    regressionStrategy: strategy,
    changedFilesOverride: ['src/components/ui/Button.tsx'],
  });
  assert.equal(result.reconciledRegIds.length, 0);
  assert.equal(result.newlyDiscovered.length, 0);
});

test('focused regression-scope decision limits reconciliation to high-risk consumers', () => {
  const dir = makeSharedComponentFixture();
  const plan = regressionRequiredFixtures('run-regression-1')['verification-plan.md'];
  const result = runPostImplementationRegressionReconciliation({
    root: dir,
    planText: plan,
    run: { flags: { regression_scope_strategy: 'focused_high_risk_scope' } },
    regressionStrategy,
    changedFilesOverride: ['src/components/ui/Button.tsx'],
  });
  assert.equal(result.scopeStrategy, 'focused_high_risk_scope');
  assert.ok(result.reconciledScenarios.length > 0);
  assert.ok(result.reconciledScenarios.every((scenario) => scenario.priority === 'high'));
});

test('changed blast-radius classification requires reconciled execution evidence', () => {
  const dir = makeSharedComponentFixture();
  const fixtures = regressionRequiredFixtures('run-regression-1');
  const plan = fixtures['verification-plan.md'].replace(
    '[high risk, automated, manual QA]',
    '[low risk, automated, manual QA]'
  );
  const reconciliation = runPostImplementationRegressionReconciliation({
    root: dir,
    planText: plan,
    run: {},
    regressionStrategy,
    changedFilesOverride: ['src/components/ui/Button.tsx'],
  });
  assert.ok(reconciliation.classificationChanged.some((scenario) => scenario.regId === 'REG-001'));
  const evidence = applyReconciliationToEvidence(
    fixtures['verification-evidence.md'],
    reconciliation
  );
  const gate = regressionGateSatisfied(
    buildRegressionCoverage({ planText: plan, evidenceText: evidence, runId: 'run-regression-1' }),
    parseRegressionStrategyFromPlan(plan)
  );
  assert.equal(gate.ok, false);
  assert.ok(gate.reasons.some((reason) => /changed blast-radius classification/.test(reason)));
});

test('reconciled REG IDs are persisted in verification evidence marker', () => {
  const evidence = applyReconciliationToEvidence('# Verification Evidence\n\n## Scenario coverage\n', {
    reconciledRegIds: ['REG-001', 'REG-004'],
    changedFiles: ['src/a.tsx'],
    actualImpact: { highImpactFiles: ['src/a.tsx'] },
    newlyDiscovered: [{ regId: 'REG-004' }],
    rows: [{ change: 'a', consumer: 'b', planned: 'No', isNew: 'Yes', risk: 'medium', regId: 'REG-004', status: 'newly_discovered' }],
    reconciledScenarios: [{ regId: 'REG-001' }, { regId: 'REG-004' }],
  });
  assert.deepEqual(parseReconciledRegIdsFromEvidence(evidence), ['REG-001', 'REG-004']);
});

test('stale regression evidence remains rejected after reconciliation marker', () => {
  const fixtures = regressionRequiredFixtures('run-regression-1');
  const evidence = fixtures['verification-evidence.md'].replace(/run-regression-1/g, 'run-previous');
  const gate = regressionGateSatisfied(
    buildRegressionCoverage({
      planText: fixtures['verification-plan.md'],
      evidenceText: applyReconciliationToEvidence(evidence, {
        reconciledRegIds: ['REG-001', 'REG-002'],
        changedFiles: [],
        actualImpact: { highImpactFiles: [] },
        newlyDiscovered: [],
        rows: [],
        reconciledScenarios: [],
      }),
      runId: 'run-regression-1',
    }),
    parseRegressionStrategyFromPlan(fixtures['verification-plan.md'])
  );
  assert.equal(gate.ok, false);
});

test('no longer relevant planned REG IDs are preserved in impact table but excluded from gate', () => {
  const dir = makeSharedComponentFixture();
  const planned = [
    {
      regId: 'REG-001',
      changedPath: 'src/components/ui/Button.tsx',
      consumerPath: 'src/pages/NonExistentPage.tsx',
      priority: 'medium',
      automated: true,
      manual: true,
    },
  ];
  const result = reconcileRegressionImpact({
    root: dir,
    plannedScenarios: planned,
    changedFiles: ['src/components/ui/Button.tsx'],
    regressionStrategy,
  });
  const stale = result.rows.find((r) => r.regId === 'REG-001');
  assert.equal(stale.status, 'no_longer_relevant');
  assert.ok(result.reconciledScenarios.every((s) => s.regId !== 'REG-001'));
  assert.ok(result.newlyDiscovered.length >= 1);
});

test('formatRegId supports sequential newly discovered IDs', () => {
  assert.equal(formatRegId(4), 'REG-004');
});

test('planned regression scenarios with current-run evidence survive inconclusive change detection', () => {
  const planned = [
    {
      regId: 'REG-001',
      changedPath: 'src/pages/Todos.tsx',
      consumerPath: 'src/pages/Todos.tsx',
      priority: 'medium',
      riskClassification: 'medium',
      classification: 'unknown',
      automated: true,
      manual: true,
      expectedBehavior: 'Existing behavior unchanged',
    },
  ];
  const result = reconcileRegressionImpact({
    root: process.cwd(),
    plannedScenarios: planned,
    changedFiles: [],
    regressionStrategy: { required: true, automated: { required: true }, manual: { required: true } },
    evidenceBackedRegIds: ['REG-001'],
    preservePlannedWhenChangesUnknown: true,
  });
  assert.ok(result.reconciledScenarios.some((scenario) => scenario.regId === 'REG-001'));
  assert.equal(result.noLongerRelevant.length, 0);
});
