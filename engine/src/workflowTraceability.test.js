import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  buildRequirementCoverage,
  parseTestStrategy,
} from './requirementVerification.js';
import { computeFinalStatus } from './verify.js';
import {
  readyFixtures,
  manualOnlyFixtures,
  staleRunEvidenceFixtures,
  writeFixtureBundle,
} from '../test/fixtures/verifyFixtures.js';

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

const implementedRun = {
  ...baseRun,
  completed_phases: ['implement'],
};

test('missing Test Implementation produces NOT READY when automation required', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-wf-'));
  const overrides = readyFixtures('run-current');
  overrides['verification-plan.md'] = overrides['verification-plan.md'].replace(
    /## Test Implementation[\s\S]*?(?=\n## Verification matrix)/,
    `## Test Implementation

| AC | Scenario ID | File / location | Test name / scenario covered |
|----|-------------|-----------------|------------------------------|

## Verification matrix`
  );
  writeFixtureBundle(dir, 'no-impl', { runId: 'run-current', overrides });
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
  const { status } = computeFinalStatus({
    run: baseRun,
    coverage,
    strategy: parseTestStrategy(plan),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    backend: '',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
  });
  assert.equal(status, 'NOT READY');
});

test('stale execution evidence cannot satisfy READY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-wf-'));
  writeFixtureBundle(dir, 'stale', {
    runId: 'run-current',
    overrides: staleRunEvidenceFixtures('run-current', 'run-previous'),
  });
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
  const { status } = computeFinalStatus({
    run: baseRun,
    coverage,
    strategy: parseTestStrategy(plan),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    backend: '',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
  });
  assert.equal(status, 'NOT READY');
});

test('manual-only strategy requires AC-linked manual evidence for READY', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-wf-'));
  writeFixtureBundle(dir, 'manual', { runId: 'run-current', overrides: manualOnlyFixtures('run-current') });
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
  const { status } = computeFinalStatus({
    run: implementedRun,
    coverage,
    strategy: parseTestStrategy(plan),
    checks: [],
    evidence: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    contract: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    plan,
    backend: '',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
  });
  assert.equal(status, 'READY FOR REVIEW');
});

test('complete AC chain produces READY FOR REVIEW', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-wf-'));
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
  const { status } = computeFinalStatus({
    run: implementedRun,
    coverage,
    strategy: parseTestStrategy(plan),
    checks: [{ name: 'unit tests', status: 'Passed' }],
    evidence: fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8'),
    contract: fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8'),
    plan,
    backend: '',
    intake: {},
    eosRoot: path.join(dir, '.engineering-os'),
    root: dir,
  });
  assert.equal(status, 'READY FOR REVIEW');
});
