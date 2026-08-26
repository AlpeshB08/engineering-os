import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assignAcIds,
  buildRequirementCoverage,
  findUnresolvedRequirements,
  isCurrentRunEvidence,
  mapAcceptanceCriterion,
  parseTestStrategy,
  verifyRepositoryReference,
} from './requirementVerification.js';
import { computeFinalStatus } from './verify.js';
import { readyFixtures, writeFixtureBundle } from '../test/fixtures/verifyFixtures.js';

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

test('A: developer prose without implementation reference is not Implemented', () => {
  const coverage = buildRequirementCoverage({
    contractText: '## Acceptance Criteria\n1. Export button visible\n',
    planText: `## Test Strategy\nUnit Tests: Not Required\nManual QA: Required\n## Verification matrix\n| AC1: Export button visible | x |`,
    evidenceText: '- **Run ID:** run-current\n\nGeneric Passed text only',
    reviewText: 'AC1 implemented in the organization invitation flow.',
    runId: 'run-current',
  });
  assert.notEqual(coverage[0].status, 'Implemented');
});

test('B: non-existent implementation reference is not repository-verified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-rv-'));
  const coverage = buildRequirementCoverage({
    contractText: '## Acceptance Criteria\n1. Export button visible\n',
    planText: '## Test Strategy\nUnit Tests: Not Required\n## Verification matrix\n| AC1: Export button visible | x |',
    evidenceText: '- **Run ID:** run-current',
    reviewText: `## Implementation references\n| AC1 | src/non-existent-file.js | foo | missing file |`,
    consumerRoot: dir,
    runId: 'run-current',
  });
  assert.equal(coverage[0].implementationEvidence.repositoryVerified, false);
  assert.notEqual(coverage[0].status, 'Implemented');
});

test('C: valid file and symbol is repository-verified', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-rv-'));
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src/example.js'), 'export function exampleFunction() {}\n');
  const check = verifyRepositoryReference(dir, 'src/example.js', 'exampleFunction');
  assert.equal(check.repositoryVerified, true);
});

test('D: previous-run Passed evidence does not satisfy current run', () => {
  const coverage = buildRequirementCoverage({
    contractText: '## Acceptance Criteria\n1. Export button visible\n',
    planText: readyFixtures('run-old')['verification-plan.md'],
    evidenceText: `# Verification Evidence\n- **Run ID:** run-current\n\n## Scenario coverage\n| AC1 | S1 | run-old | test | Passed | |`,
    reviewText: readyFixtures('run-current')['review-notes.md'],
    consumerRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'eos-rv-')),
    runId: 'run-current',
  });
  assert.notEqual(coverage[0].status, 'Implemented');
  assert.equal(isCurrentRunEvidence({ evidenceRunId: 'run-old' }, 'run-current'), false);
});

test('E: AC1 evidence must not satisfy AC2 via weak matching', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-rv-'));
  writeFixtureBundle(dir, 'split', {
    runId: 'run-current',
    overrides: {
      ...readyFixtures('run-current'),
      'feature-contract.md': `# Feature Contract\n\n## Acceptance Criteria\n\n1. Export button visible\n2. Admin audit log entry\n`,
      'verification-evidence.md': `# Verification Evidence\n- **Run ID:** run-current\n\n## Scenario coverage\n| AC1 | AC1-T01 | run-current | test | Passed | |`,
    },
  });
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-current');
  const coverage = buildRequirementCoverage({
    contractText: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    planText: fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8'),
    evidenceText: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    consumerRoot: dir,
    runId: 'run-current',
  });
  const ac2 = coverage.find((c) => c.acId === 'AC2');
  assert.notEqual(ac2.status, 'Implemented');
});

test('F: manual NotRequired without strategy is rejected', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-rv-'));
  writeFixtureBundle(dir, 'manual-bypass', {
    runId: 'run-current',
    overrides: {
      ...readyFixtures('run-current'),
      'verification-plan.md': readyFixtures('run-current')['verification-plan.md'].replace(
        'Unit Tests: Required',
        'Unit Tests: Required'
      ),
      'verification-evidence.md': `# Verification Evidence

- **Run ID:** run-current

## Scenario coverage

| AC | Scenario ID | Run ID | Executed test / manual result | Status | Timestamp |
|----|-------------|--------|-------------------------------|--------|-----------|
| AC1 | AC1-T01 | run-current | n/a | Not Required | 2026-08-12 |
| AC2 | AC2-T01 | run-current | n/a | Not Required | 2026-08-12 |

## Manual checks

| AC | Check | Result | Run ID |
|----|-------|--------|--------|
| AC1 | export visible | Not Required | run-current |
| AC2 | csv download | Not Required | run-current |
`,
    },
  });
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-current');
  const coverage = buildRequirementCoverage({
    contractText: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    planText: fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8'),
    evidenceText: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    consumerRoot: dir,
    runId: 'run-current',
  });
  assert.ok(coverage.every((c) => c.status !== 'Implemented'));
  assert.ok(coverage.some((c) => c.executionState === 'NOT_RUN'));
});

test('G: complete AC-specific current-run chain can reach READY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-rv-'));
  writeFixtureBundle(dir, 'ready', { runId: 'run-current', overrides: readyFixtures('run-current') });
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-current');
  const coverage = buildRequirementCoverage({
    contractText: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    planText: fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8'),
    evidenceText: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    strategy: parseTestStrategy(fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8')),
    consumerRoot: dir,
    runId: 'run-current',
  });
  const { status } = computeFinalStatus({
    run: baseRun,
    coverage,
    strategy: parseTestStrategy(fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8')),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
    plan: fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8'),
    contract: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
  });
  assert.equal(status, 'READY FOR REVIEW');
});

test('removing a required repository test prevents READY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-rv-remove-test-'));
  writeFixtureBundle(dir, 'ready', { runId: 'run-current', overrides: readyFixtures('run-current') });
  fs.rmSync(path.join(dir, 'tests/unit/example.test.js'));
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-current');
  const plan = fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8');
  const contract = fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8');
  const evidence = fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8');
  const coverage = buildRequirementCoverage({
    contractText: contract,
    planText: plan,
    evidenceText: evidence,
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    consumerRoot: dir,
    runId: 'run-current',
  });
  assert.ok(coverage.every((item) => item.executionState === 'NOT_RUN'));
  const result = computeFinalStatus({
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
    contract,
  });
  assert.equal(result.status, 'IMPLEMENTED_BUT_VERIFICATION_PENDING');
});

test('assignAcIds produces stable AC identifiers', () => {
  const ids = assignAcIds(['First', 'Second']);
  assert.deepEqual(ids.map((i) => i.acId), ['AC1', 'AC2']);
});

test('findUnresolvedRequirements lists AC-specific gaps', () => {
  const reasons = findUnresolvedRequirements([
    { acId: 'AC1', requirement: 'Test', status: 'Partial', implementationEvidence: { repositoryVerified: false }, testScenarioEvidence: null, executionState: 'NOT_RUN', provenance: {} },
  ]);
  assert.ok(reasons[0].includes('AC1'));
});
