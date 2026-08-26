import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { computeFinalStatus } from './verify.js';
import { hasBlockers } from './orchestration.js';
import { readyFixtures, writeFixtureBundle } from '../test/fixtures/verifyFixtures.js';
import { buildRequirementCoverage, parseTestStrategy } from './requirementVerification.js';

const baseRun = {
  id: 'run-current',
  blocked: false,
  gates: {
    'plan-approval': { status: 'approved', run_id: 'run-current' },
    'contract-approval': { status: 'approved', run_id: 'run-current' },
  },
  completed_phases: [],
  orchestration: { blockers: [] },
};

test('BLOCKED when run has orchestration blockers', () => {
  const run = { blocked: true, gates: {}, orchestration: { blockers: [{ type: 'jira' }] } };
  assert.equal(hasBlockers(run), true);
  const { status } = computeFinalStatus({
    run,
    coverage: [],
    strategy: { unitRequired: false, e2eRequired: false, manualRequired: false },
    checks: [],
    evidence: '',
    backend: '**Backend availability:** resolved',
    intake: {},
    eosRoot: '/tmp/.engineering-os',
    root: '/tmp',
  });
  assert.equal(status, 'BLOCKED');
});

test('NOT READY when acceptance criteria partially verified', () => {
  const { status } = computeFinalStatus({
    run: baseRun,
    coverage: [
      {
        acId: 'AC1',
        requirement: 'Export button visible',
        status: 'Partial',
        executionState: 'NotRun',
        implementationEvidence: { repositoryVerified: false },
        provenance: {},
      },
      {
        acId: 'AC2',
        requirement: 'CSV download works',
        status: 'Missing',
        executionState: 'NotRun',
        implementationEvidence: { repositoryVerified: false },
        provenance: {},
      },
    ],
    strategy: { unitRequired: true, e2eRequired: false, manualRequired: false },
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence: '- **Run ID:** run-current',
    backend: '**Backend availability:** resolved',
    intake: {},
    eosRoot: '/tmp/.engineering-os',
    root: '/tmp',
  });
  assert.equal(status, 'NOT READY');
});

test('NOT READY when generic Passed text without AC chain', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-v-'));
  writeFixtureBundle(dir, 'generic', {
    runId: 'run-current',
    overrides: {
      'feature-contract.md': '## Acceptance Criteria\n1. Export button visible\n',
      'verification-plan.md': '## Test Strategy\nUnit Tests: Required\n## Verification matrix\n| AC1: Export | x |',
      'verification-evidence.md': '- **Run ID:** run-current\n\nPassed\nexit: 0 — Passed',
      'review-notes.md': '## Implementation references\n| AC | File | Symbol | Description |\n',
    },
  });
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-current');
  const coverage = buildRequirementCoverage({
    contractText: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    planText: fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8'),
    evidenceText: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    runId: 'run-current',
    consumerRoot: dir,
  });
  const { status } = computeFinalStatus({
    run: baseRun,
    coverage,
    strategy: parseTestStrategy(fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8')),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    backend: '',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
  });
  assert.equal(status, 'NOT READY');
});

test('READY FOR REVIEW when all ACs fully evidenced for current run', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-v-'));
  writeFixtureBundle(dir, 'ready', { runId: 'run-current', overrides: readyFixtures('run-current') });
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', 'run-current');
  const plan = fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8');
  const coverage = buildRequirementCoverage({
    contractText: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    planText: plan,
    evidenceText: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    reviewText: fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8'),
    consumerRoot: dir,
    runId: 'run-current',
  });
  const incomplete = computeFinalStatus({
    run: baseRun,
    coverage,
    strategy: parseTestStrategy(plan),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
    plan,
    contract: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
  });
  assert.equal(incomplete.status, 'NOT READY');
  const { status } = computeFinalStatus({
    run: { ...baseRun, completed_phases: ['implement'] },
    coverage,
    strategy: parseTestStrategy(plan),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
    plan,
    contract: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
  });
  assert.equal(status, 'READY FOR REVIEW');
});

test('stale contract or required architecture gate prevents READY', () => {
  const run = {
    ...baseRun,
    completed_phases: ['implement'],
    flags: { architectural_impact: true },
    gates: {
      'plan-approval': { status: 'approved', run_id: 'run-current' },
      'contract-approval': { status: 'approved', run_id: 'run-old' },
      'architecture-approval': { status: 'approved', run_id: 'run-current' },
    },
  };
  const result = computeFinalStatus({
    run,
    coverage: [],
    strategy: { unitRequired: false, e2eRequired: false, manualRequired: false },
    checks: [],
    evidence: '- **Run ID:** run-current',
    backend: '',
    intake: {},
    eosRoot: '/tmp/.engineering-os',
    root: '/tmp',
    plan: '- **Run ID:** run-current',
    contract: '## Acceptance Criteria',
  });
  assert.equal(result.status, 'IMPLEMENTED_BUT_VERIFICATION_PENDING');
  assert.ok(result.reasons.some((reason) => /contract-approval/.test(reason)));
});

test('zero acceptance criteria never produces READY', () => {
  const plan = `# Verification Plan
- **Run ID:** run-current
## Test Strategy
Unit Tests: Not Required
E2E Tests: Not Required
Manual QA: Not Required
## Regression Strategy
Strategy: Not Required
Automated Regression: Not Required
Manual QA Regression: Not Required
## Test Scenarios
### Unit test scenarios
- _(not required)_
### E2E test scenarios
- _(not required)_
### Manual test scenarios
- _(not required)_
## Regression Scenarios
- _(not required)_
`;
  const result = computeFinalStatus({
    run: { ...baseRun, completed_phases: ['implement'] },
    coverage: [],
    strategy: { unitRequired: false, e2eRequired: false, manualRequired: false },
    checks: [],
    evidence: '- **Run ID:** run-current',
    backend: '',
    intake: {},
    eosRoot: '/tmp/.engineering-os',
    root: '/tmp',
    plan,
    contract: '## Acceptance Criteria\n',
  });
  assert.equal(result.status, 'IMPLEMENTED_BUT_VERIFICATION_PENDING');
});

test('BLOCKED when required Jira discovery incomplete', () => {
  const { status } = computeFinalStatus({
    run: { blocked: false, gates: {}, orchestration: { blockers: [] } },
    coverage: [],
    strategy: { unitRequired: false, e2eRequired: false, manualRequired: false },
    checks: [],
    evidence: '',
    backend: '',
    intake: { jira: { key: 'TEST-1' } },
    eosRoot: '/tmp/.engineering-os',
    root: '/tmp',
  });
  assert.equal(status, 'BLOCKED');
});

test('NOT READY when evidence Run ID mismatches current run', () => {
  const { status } = computeFinalStatus({
    run: baseRun,
    coverage: [],
    strategy: { unitRequired: false, e2eRequired: false, manualRequired: false },
    checks: [],
    evidence: '- **Run ID:** run-other',
    backend: '',
    intake: {},
    eosRoot: '/tmp/.engineering-os',
    root: '/tmp',
  });
  assert.equal(status, 'NOT READY');
});
