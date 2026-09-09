import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectCapabilities } from '../detect.js';
import { decideTestStrategy, analyzeFeatureRisk } from './testStrategy.js';
import {
  CAPABILITY_STATUS,
  FAILURE_CLASS,
  SETUP_VERIFICATION,
  applyApprovedTestCapabilitySetup,
  applyStagedTestCapabilitySetupIfNeeded,
  buildSetupProposal,
  buildPackageManagerCommand,
  classifyTestExecutionFailure,
  computeRiskAutomationNeeds,
  detectRepositoryEcosystem,
  detectTestCapabilities,
  evaluateReuseDecision,
  executeApprovedTestCapabilitySetup,
  isAutomationAvailable,
  isApplicationMutationPermittedForSetup,
  isTestCapabilityDecisionPending,
  recordTestCapabilityDecision,
  resolveTestStrategyWithCapabilities,
  stageTestCapabilitySetup,
  verifyTestCapabilitySetup,
} from './testCapabilities.js';
import { computeFinalStatus } from '../verify.js';
import {
  buildRequirementCoverage,
  parseTestStrategy,
} from '../requirementVerification.js';
import {
  readyFixtures,
  writeFixtureBundle,
} from '../../test/fixtures/verifyFixtures.js';

function makeDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'eos-tcap-'));
}

function readyVerificationContext(runId = 'r1') {
  const root = makeDir();
  writeFixtureBundle(root, 'ready', {
    runId,
    overrides: readyFixtures(runId),
  });
  const artifactsDir = path.join(root, '.engineering-os', 'artifacts', runId);
  const contract = fs.readFileSync(path.join(artifactsDir, 'feature-contract.md'), 'utf8');
  const plan = fs.readFileSync(path.join(artifactsDir, 'verification-plan.md'), 'utf8');
  const evidence = fs.readFileSync(path.join(artifactsDir, 'verification-evidence.md'), 'utf8');
  const review = fs.readFileSync(path.join(artifactsDir, 'review-notes.md'), 'utf8');
  const coverage = buildRequirementCoverage({
    contractText: contract,
    planText: plan,
    evidenceText: evidence,
    reviewText: review,
    consumerRoot: root,
    runId,
  });
  return {
    root,
    contract,
    plan,
    evidence,
    coverage,
    strategy: parseTestStrategy(plan),
    run: {
      id: runId,
      status: 'active',
      current_phase: 'verify',
      blocked: false,
      completed_phases: ['implement'],
      workflow_decisions: {},
      orchestration: { blockers: [] },
      gates: {
        'plan-approval': { status: 'approved', run_id: runId },
        'contract-approval': { status: 'approved', run_id: runId },
      },
    },
  };
}

function writePkg(dir, body) {
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(body, null, 2));
}

test('1: existing Unit framework detected as available', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '2.0.0' },
  });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.unit.status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(caps.unit.framework, 'vitest');
  assert.ok(caps.unit.runCommand.includes('test'));
});

test('2: existing E2E framework detected as available', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { 'test:e2e': 'playwright test' },
    devDependencies: { '@playwright/test': '1.49.0' },
  });
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.e2e.status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(caps.e2e.framework, 'playwright');
});

test('3: no E2E framework detected as unavailable', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { test: 'node --test' } });
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.e2e.status, CAPABILITY_STATUS.UNAVAILABLE);
});

test('4: partial E2E configuration detected', () => {
  const dir = makeDir();
  writePkg(dir, { devDependencies: { '@playwright/test': '1.49.0' } });
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.e2e.status, CAPABILITY_STATUS.PARTIAL);
  assert.ok(caps.e2e.gaps.some((g) => /script/i.test(g)));
});

test('5: user approves test infrastructure setup', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { build: 'vite build' }, devDependencies: { vite: '6.0.0' } });
  const caps = detectTestCapabilities(dir, detectCapabilities(dir));
  const strategy = decideTestStrategy({
    contractText: 'auth login permission delete user workflow',
    impactText: '## Routes / screens\n- `src/pages/Login.tsx`\n',
    capabilities: detectCapabilities(dir),
    intake: {},
  });
  const run = {};
  const pending = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.ok(pending.needsApproval);
  recordTestCapabilityDecision(run, 'unit', 'approved');
  recordTestCapabilityDecision(run, 'e2e', 'approved');
  const approved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(approved.needsApproval, false);
  assert.equal(approved.strategy.unit.required, true);
});

test('6: user declines test infrastructure setup', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { build: 'vite build' } });
  const caps = detectTestCapabilities(dir);
  const signals = analyzeFeatureRisk({
    contractText: 'auth login permission delete',
    impactText: '## Routes / screens\n- `src/pages/Login.tsx`\n',
  });
  const strategy = {
    unit: { required: false, reason: '' },
    e2e: { required: false, reason: '' },
    manual: { required: true, reason: '' },
    risk: computeRiskAutomationNeeds(signals),
    signals,
    repository: {},
  };
  const run = {};
  resolveTestStrategyWithCapabilities({ strategy, testCapabilities: caps, run, root: dir });
  recordTestCapabilityDecision(run, 'unit', 'declined');
  recordTestCapabilityDecision(run, 'e2e', 'declined');
  const resolved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(resolved.strategy.unit.required, false);
  assert.equal(resolved.strategy.manual.required, true);
  assert.equal(resolved.needsApproval, false);
});

test('7: approved setup writes minimal infrastructure files', () => {
  const dir = makeDir();
  writePkg(dir, { name: 'demo', scripts: {} });
  const proposals = [
    buildSetupProposal(dir, 'unit', detectTestCapabilities(dir)),
    buildSetupProposal(dir, 'e2e', detectTestCapabilities(dir)),
  ];
  const result = applyApprovedTestCapabilitySetup(dir, proposals);
  assert.equal(result.mode, 'applied');
  assert.ok(result.written.some((f) => f.includes('vitest.config.ts') || f.includes('jest.config.js')));
  assert.ok(result.written.some((f) => f.includes('package.json')));
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.test);
});

test('7b: approved setup stages under .engineering-os when application mutation not permitted', () => {
  const dir = makeDir();
  writePkg(dir, { name: 'demo', scripts: {} });
  fs.mkdirSync(path.join(dir, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.engineering-os/state.json'),
    JSON.stringify({ version: 1, active_run: { id: 'run-stage' } })
  );
  const proposals = [buildSetupProposal(dir, 'e2e', detectTestCapabilities(dir))];
  const run = {
    id: 'run-stage',
    status: 'active',
    current_phase: 'approve',
    blocked: false,
    orchestration: { blockers: [] },
    gates: { 'plan-approval': { status: 'pending' }, 'contract-approval': { status: 'pending' } },
    workflow_decisions: {},
  };
  const result = applyApprovedTestCapabilitySetup(dir, proposals, { run });
  assert.equal(result.mode, 'staged');
  assert.equal(fs.existsSync(path.join(dir, 'playwright.config.ts')), false);
  assert.ok(fs.existsSync(path.join(dir, '.engineering-os', 'test-setup-staging', 'run-stage', 'manifest.json')));
});

test('8: declined setup falls back to Manual QA in resolved strategy', () => {
  const run = { test_capability_decisions: { unit: 'declined', e2e: 'declined' } };
  const strategy = {
    unit: { required: false, reason: '' },
    e2e: { required: false, reason: '' },
    manual: { required: false, reason: '' },
    risk: { unit: true, e2e: true },
    signals: { high_risk: ['auth'] },
    repository: {},
  };
  const resolved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: detectTestCapabilities(makeDir()),
    run,
    root: makeDir(),
  });
  assert.equal(resolved.strategy.manual.required, true);
});

test('9: classify successful execution is not infrastructure failure', () => {
  const result = classifyTestExecutionFailure({
    name: 'e2e',
    output: '3 passed',
    exitCode: 0,
    command: 'playwright test',
  });
  assert.notEqual(result.kind, FAILURE_CLASS.INFRASTRUCTURE);
});

test('10: existing E2E test failure classified as test failure', () => {
  const result = classifyTestExecutionFailure({
    name: 'e2e',
    output: 'Expected element to be visible\nAssertionError: not visible',
    exitCode: 1,
    command: 'playwright test',
  });
  assert.equal(result.kind, FAILURE_CLASS.TEST);
});

test('11: application failure distinguished from infrastructure failure', () => {
  const app = classifyTestExecutionFailure({
    name: 'e2e',
    output: '500 internal server error uncaught exception in app',
    exitCode: 1,
  });
  const infra = classifyTestExecutionFailure({
    name: 'e2e',
    output: 'browser executable not found cannot find module @playwright/test',
    exitCode: 1,
  });
  assert.equal(app.kind, FAILURE_CLASS.APPLICATION);
  assert.equal(infra.kind, FAILURE_CLASS.INFRASTRUCTURE);
  assert.equal(infra.requiresApprovalToRepair, true);
});

test('12: infrastructure failure distinguished from test failure in READY calc', () => {
  const ctx = readyVerificationContext();
  const status = computeFinalStatus({
    ...ctx,
    checks: [
      {
        name: 'unit tests',
        status: 'Infrastructure Failed',
        failureSummary: 'cannot find module vitest',
      },
    ],
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    eosRoot: path.join(ctx.root, '.engineering-os'),
  });
  assert.equal(status.status, 'IMPLEMENTED_BUT_VERIFICATION_PENDING');
  assert.match(status.reasons[0], /cannot find module|infrastructure/i);
});

test('13: infrastructure repair requires approval flag', () => {
  const result = classifyTestExecutionFailure({
    name: 'e2e',
    output: 'configuration error: missing playwright config',
    exitCode: 1,
  });
  assert.equal(result.requiresApprovalToRepair, true);
});

test('14: YAGNI reuse prefers existing repository capabilities', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { test: 'jest' },
    devDependencies: { jest: '29.0.0' },
  });
  fs.writeFileSync(path.join(dir, 'jest.config.js'), 'module.exports = {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.unit.reuseDecision.introduceNew, false);
  assert.match(caps.unit.reuseDecision.reason, /Reuse existing/i);
});

test('15: capability detection works across different repository structures', () => {
  const dir = makeDir();
  fs.mkdirSync(path.join(dir, 'tests', 'e2e'), { recursive: true });
  writePkg(dir, {
    scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
    devDependencies: { vitest: '2.0.0', '@playwright/test': '1.49.0' },
  });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.unit.status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(caps.e2e.status, CAPABILITY_STATUS.AVAILABLE);
});

test('16: unit and E2E capability detection are independent', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { test: 'vitest run' },
    devDependencies: { vitest: '2.0.0' },
  });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.unit.status, CAPABILITY_STATUS.AVAILABLE);
  assert.equal(caps.e2e.status, CAPABILITY_STATUS.UNAVAILABLE);
});

test('edge: dependency without config is uncertain not available', () => {
  const dir = makeDir();
  writePkg(dir, { devDependencies: { vitest: '2.0.0' } });
  const caps = detectTestCapabilities(dir);
  assert.notEqual(caps.unit.status, CAPABILITY_STATUS.AVAILABLE);
});

test('edge: test script without identifiable framework remains partial/uncertain', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { test: 'node --test tests/**/*.test.js' } });
  const caps = detectTestCapabilities(dir);
  assert.notEqual(caps.unit.status, CAPABILITY_STATUS.AVAILABLE);
});

test('edge: multiple supported frameworks prefer detected evidence', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
    devDependencies: { vitest: '2.0.0', '@playwright/test': '1.49.0', cypress: '13.0.0' },
  });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.unit.framework, 'vitest');
  assert.equal(caps.e2e.framework, 'playwright');
});

test('edge: custom e2e script maps to run command when available', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { e2e: 'cypress run' },
    devDependencies: { cypress: '13.0.0' },
  });
  fs.writeFileSync(path.join(dir, 'cypress.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.e2e.status, CAPABILITY_STATUS.AVAILABLE);
  assert.match(caps.e2e.runCommand, /e2e/);
});

test('edge: missing dev-server noted for e2e capability context', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { 'test:e2e': 'playwright test' }, devDependencies: { '@playwright/test': '1.0.0' } });
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.devServer.status, CAPABILITY_STATUS.UNAVAILABLE);
  assert.equal(caps.e2e.status, CAPABILITY_STATUS.AVAILABLE);
});

test('edge: repository with unit tests but no e2e', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { test: 'vitest run' }, devDependencies: { vitest: '1.0.0' } });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  assert.equal(isAutomationAvailable(caps.unit), true);
  assert.equal(isAutomationAvailable(caps.e2e), false);
});

test('edge: repository with neither unit nor e2e infrastructure', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { build: 'tsc' } });
  const caps = detectTestCapabilities(dir);
  assert.equal(caps.unit.status, CAPABILITY_STATUS.UNAVAILABLE);
  assert.equal(caps.e2e.status, CAPABILITY_STATUS.UNAVAILABLE);
});

test('existing AC verification behavior unchanged when manual only', () => {
  const status = computeFinalStatus({
    run: {
      id: 'r1',
      blocked: false,
      gates: {
        'plan-approval': { status: 'approved', run_id: 'r1' },
        'contract-approval': { status: 'approved', run_id: 'r1' },
      },
    },
    coverage: [{ acId: 'AC1', status: 'Implemented', executionState: 'Passed' }],
    strategy: { unitRequired: false, e2eRequired: false, manualRequired: true },
    checks: [],
    evidence: 'Run ID: r1',
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    plan: 'Unit Tests: Not Required\nE2E Tests: Not Required\nManual QA: Required',
  });
  assert.notEqual(status.status, 'BLOCKED');
});

test('regression verification behavior unchanged — not modified by capability manager', () => {
  const dir = makeDir();
  const caps = detectTestCapabilities(dir);
  assert.ok(caps);
  assert.ok(typeof caps.unit.status === 'string');
});

test('READY behavior valid when required automation available and passing', () => {
  const ctx = readyVerificationContext();
  const status = computeFinalStatus({
    ...ctx,
    checks: [{ name: 'unit tests', status: 'Passed' }],
    backend: 'needs backend per contract heuristics: no',
    intake: {},
    eosRoot: path.join(ctx.root, '.engineering-os'),
  });
  assert.equal(status.status, 'READY FOR REVIEW');
});

test('ecosystem: npm repository detected', () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'package-lock.json'), '{}');
  writePkg(dir, { name: 'demo' });
  const eco = detectRepositoryEcosystem(dir);
  assert.equal(eco.packageManager, 'npm');
});

test('ecosystem: pnpm repository detected', () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writePkg(dir, { name: 'demo' });
  assert.equal(detectRepositoryEcosystem(dir).packageManager, 'pnpm');
});

test('ecosystem: yarn repository detected', () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'yarn.lock'), '# yarn\n');
  writePkg(dir, { name: 'demo' });
  assert.equal(detectRepositoryEcosystem(dir).packageManager, 'yarn');
});

test('ecosystem: bun repository detected', () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'bun.lockb'), '');
  writePkg(dir, { name: 'demo' });
  assert.equal(detectRepositoryEcosystem(dir).packageManager, 'bun');
});

test('ecosystem: python repository detected', () => {
  const dir = makeDir();
  fs.writeFileSync(path.join(dir, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
  const eco = detectRepositoryEcosystem(dir);
  assert.ok(eco.languages.detected.includes('python'));
});

test('ecosystem: monorepo workspace detected', () => {
  const dir = makeDir();
  writePkg(dir, { private: true, workspaces: ['packages/*'] });
  fs.writeFileSync(path.join(dir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
  const caps = detectTestCapabilities(dir, detectCapabilities(dir));
  assert.equal(caps.ecosystem.monorepo, true);
});

test('recommendation uses ecosystem and existing framework preference', () => {
  const dir = makeDir();
  writePkg(dir, { devDependencies: { jest: '29.0.0' }, scripts: { test: 'jest' } });
  fs.writeFileSync(path.join(dir, 'jest.config.js'), 'module.exports = {}');
  const caps = detectTestCapabilities(dir);
  const proposal = buildSetupProposal(dir, 'unit', caps);
  assert.equal(proposal.recommendedFramework, 'jest');
  assert.ok(proposal.whyFitsEcosystem);
});

test('package manager command is not hard-coded npm', () => {
  assert.match(buildPackageManagerCommand('pnpm', 'add-dev', 'vitest'), /^pnpm add -D vitest$/);
  assert.match(buildPackageManagerCommand('yarn', 'run', 'test'), /^yarn run test$/);
  assert.match(buildPackageManagerCommand('bun', 'add-dev', 'vitest'), /^bun add -d vitest$/);
});

test('approved setup uses detected package manager via execFn', () => {
  const dir = makeDir();
  writePkg(dir, { name: 'demo', scripts: {} });
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const caps = detectTestCapabilities(dir);
  const proposal = buildSetupProposal(dir, 'unit', caps);
  const calls = [];
  const result = executeApprovedTestCapabilitySetup(dir, [proposal], {
    execFn: (cmd) => {
      calls.push(cmd);
      return '';
    },
  });
  assert.equal(result.ok, true);
  assert.ok(calls.some((c) => c.startsWith('pnpm add -D')));
});

test('setup verification classifies failure and enables manual fallback', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { test: 'missing-command' } });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  caps.unit.runCommand = 'npm run test';
  caps.unit.status = CAPABILITY_STATUS.AVAILABLE;
  const verification = verifyTestCapabilitySetup(dir, 'unit', caps, {
    execFn: () => {
      const err = new Error('fail');
      err.status = 1;
      err.stderr = 'cannot find module vitest';
      throw err;
    },
  });
  assert.equal(verification.status, SETUP_VERIFICATION.FAILED);
  const run = { test_capability_decisions: {} };
  recordTestCapabilityDecision(run, 'unit', 'declined');
  const resolved = resolveTestStrategyWithCapabilities({
    strategy: { unit: {}, e2e: {}, manual: {}, risk: { unit: true, e2e: false }, signals: {}, repository: {} },
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(resolved.strategy.unit.required, false);
  assert.equal(resolved.strategy.manual.required, true);
});

test('approved setup always installs declared dependencies', () => {
  const dir = makeDir();
  writePkg(dir, { name: 'demo' });
  const calls = [];
  executeApprovedTestCapabilitySetup(
    dir,
    [buildSetupProposal(dir, 'unit', detectTestCapabilities(dir))],
    {
      execFn: (cmd) => calls.push(cmd),
    }
  );
  assert.ok(calls.some((command) => command.includes('install')));
});

function makeHighRiskE2eStrategy(dir) {
  const caps = detectTestCapabilities(dir, detectCapabilities(dir));
  const strategy = decideTestStrategy({
    contractText: 'auth login permission delete user workflow onboarding journey',
    impactText: '## Routes / screens\n- `src/pages/Login.tsx`\n- `src/pages/Dashboard.tsx`\n',
    capabilities: detectCapabilities(dir),
    intake: {},
  });
  return { caps, strategy };
}

test('E2E required + available continues without setup approval', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { test: 'vitest run', 'test:e2e': 'playwright test' },
    devDependencies: { vitest: '2.0.0', '@playwright/test': '1.49.0' },
  });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
  const { caps, strategy } = makeHighRiskE2eStrategy(dir);
  const resolved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run: {},
    root: dir,
  });
  assert.equal(resolved.needsApproval, false);
  assert.equal(resolved.strategy.e2e.required, true);
  assert.equal(resolved.strategy.e2e.pendingApproval, undefined);
});

test('E2E required + unavailable + no user decision pauses with pending approval', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { test: 'vitest run', build: 'vite build' },
    devDependencies: { vitest: '2.0.0', vite: '6.0.0' },
  });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const { caps, strategy } = makeHighRiskE2eStrategy(dir);
  const run = {};
  const resolved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(resolved.needsApproval, false);
  assert.equal(resolved.proposals.some((p) => p.kind === 'e2e'), false);
  assert.equal(resolved.strategy.e2e.pendingApproval, true);
  assert.ok(!/declined|failed for one or more required capabilities/i.test(resolved.strategy.manual.reason));
  assert.equal(isTestCapabilityDecisionPending(resolved, run), true);
});

test('E2E required + unavailable + no decision does not auto-reject gate or enable fallback', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { build: 'vite build' }, devDependencies: { vite: '6.0.0' } });
  const { caps, strategy } = makeHighRiskE2eStrategy(dir);
  const run = { gates: { 'test-capability-setup': { status: 'pending' } } };
  const resolved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(run.gates['test-capability-setup'].status, 'pending');
  assert.equal(run.test_capability_decisions?.e2e, undefined);
  assert.equal(resolved.strategy.e2e.pendingApproval, true);
  assert.ok(isTestCapabilityDecisionPending(resolved, run));
});

test('E2E required + unavailable + explicit approval keeps E2E required', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { build: 'vite build' }, devDependencies: { vite: '6.0.0' } });
  const { caps, strategy } = makeHighRiskE2eStrategy(dir);
  const run = { test_capability_decisions: { e2e: 'approved' } };
  const resolved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(resolved.strategy.e2e.required, true);
  assert.equal(resolved.strategy.e2e.pendingApproval, undefined);
});

test('E2E required + unavailable + explicit rejection enables Manual QA fallback', () => {
  const dir = makeDir();
  writePkg(dir, {
    scripts: { test: 'vitest run', build: 'vite build' },
    devDependencies: { vitest: '2.0.0', vite: '6.0.0' },
  });
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');
  const { caps, strategy } = makeHighRiskE2eStrategy(dir);
  const run = {
    test_capability_decisions: { e2e: 'declined' },
    gates: { 'test-capability-setup': { status: 'rejected' } },
  };
  const resolved = resolveTestStrategyWithCapabilities({
    strategy,
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(resolved.needsApproval, false);
  assert.equal(resolved.strategy.e2e.required, false);
  assert.equal(resolved.strategy.manual.required, true);
  assert.match(resolved.strategy.manual.reason, /declined or failed/i);
  assert.equal(isTestCapabilityDecisionPending(resolved, run), false);
});

test('approved E2E setup failure requires explicit decision before Manual QA fallback', () => {
  const dir = makeDir();
  writePkg(dir, { scripts: { 'test:e2e': 'missing-command' }, devDependencies: { '@playwright/test': '1.49.0' } });
  fs.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
  const caps = detectTestCapabilities(dir);
  const run = {
    test_capability_decisions: { e2e: 'setup_failed' },
    test_capability_verification: {
      e2e: { status: SETUP_VERIFICATION.FAILED, summary: 'browser executable not found' },
    },
  };
  const resolved = resolveTestStrategyWithCapabilities({
    strategy: {
      unit: { required: false, reason: '' },
      e2e: { required: true, reason: '' },
      manual: { required: true, reason: 'Base manual checks.' },
      risk: { unit: false, e2e: true },
      signals: { high_risk: ['auth'] },
      repository: {},
    },
    testCapabilities: caps,
    run,
    root: dir,
  });
  assert.equal(resolved.strategy.e2e.required, true);
  assert.equal(resolved.strategy.e2e.pendingApproval, true);
  assert.equal(resolved.strategy.e2e.setupFailed, true);
  assert.ok(!/declined or failed for one or more required capabilities/i.test(resolved.strategy.manual.reason));
});

test('pending approval renders Required (pending setup approval) in strategy section', async () => {
  const { renderTestStrategySection } = await import('./testStrategy.js');
  const section = renderTestStrategySection({
    unit: { required: true, reason: 'unit available' },
    e2e: {
      required: true,
      pendingApproval: true,
      reason: 'awaiting explicit user decision',
    },
    manual: { required: true, reason: 'Always verify manually.' },
    signals: {},
    repository: {},
    strategy_label: 'E2E (pending setup approval)',
  });
  assert.match(section, /E2E Tests \| Required \(pending setup approval\)/);
  assert.match(section, /E2E Tests: Required \(pending setup approval\)/);
});

function writeState(dir, activeRun) {
  fs.mkdirSync(path.join(dir, '.engineering-os'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, '.engineering-os', 'state.json'),
    JSON.stringify({ version: 1, active_run: activeRun })
  );
}

function authorizedSetupRun(id = 'setup-run') {
  return {
    id,
    status: 'active',
    current_phase: 'implement',
    implementation_entered_at: new Date().toISOString(),
    blocked: false,
    orchestration: { blockers: [] },
    workflow_decisions: {},
    gates: {
      'plan-approval': { status: 'approved', run_id: id },
      'contract-approval': { status: 'approved', run_id: id },
    },
  };
}

test('setup mutation authorization fails closed for null, inactive, planning, and stale runs', () => {
  const dir = makeDir();
  writePkg(dir, { name: 'demo' });
  const active = authorizedSetupRun('current');
  writeState(dir, active);

  assert.equal(isApplicationMutationPermittedForSetup(dir, null), false);
  assert.equal(
    isApplicationMutationPermittedForSetup(dir, { ...active, status: 'completed' }),
    false
  );
  assert.equal(
    isApplicationMutationPermittedForSetup(dir, {
      ...active,
      current_phase: 'approve',
      implementation_entered_at: undefined,
    }),
    false
  );
  assert.equal(
    isApplicationMutationPermittedForSetup(dir, authorizedSetupRun('stale')),
    false
  );
  assert.equal(isApplicationMutationPermittedForSetup(dir, active), true);
});

test('staged setup installs, verifies runnable, and removes staging only on success', () => {
  const dir = makeDir();
  writePkg(dir, { name: 'demo', scripts: {} });
  const run = authorizedSetupRun('setup-success');
  writeState(dir, run);
  const proposal = buildSetupProposal(dir, 'unit', detectTestCapabilities(dir));
  stageTestCapabilitySetup(dir, [proposal], run);

  const result = applyStagedTestCapabilitySetupIfNeeded(dir, run, {
    execFn: (command) => {
      if (command.includes('install')) {
        const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
        pkg.devDependencies = { ...(pkg.devDependencies || {}), vitest: 'test' };
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify(pkg, null, 2));
      }
      return '';
    },
  });

  assert.equal(result.applied, true);
  assert.equal(result.verifications[0].status, SETUP_VERIFICATION.READY);
  assert.equal(
    fs.existsSync(path.join(dir, '.engineering-os', 'test-setup-staging', run.id)),
    false
  );
});

test('tampered staged setup manifest is rejected before dependency execution', () => {
  const dir = makeDir();
  writePkg(dir, { name: 'demo', scripts: {} });
  const run = authorizedSetupRun('setup-tampered');
  writeState(dir, run);
  const proposal = buildSetupProposal(dir, 'unit', detectTestCapabilities(dir));
  stageTestCapabilitySetup(dir, [proposal], run);
  const manifestPath = path.join(
    dir,
    '.engineering-os',
    'test-setup-staging',
    run.id,
    'manifest.json'
  );
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.proposals[0].installCommand = 'touch should-not-run';
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  let executed = false;

  const result = applyStagedTestCapabilitySetupIfNeeded(dir, run, {
    execFn: () => {
      executed = true;
    },
  });

  assert.equal(result.failed, true);
  assert.equal(executed, false);
  assert.match(result.reason, /differs from the approved run proposal/i);
});

test('failed staged setup remains retryable and records explicit unit failure decision', () => {
  const dir = makeDir();
  writePkg(dir, { name: 'demo', scripts: {} });
  const run = authorizedSetupRun('setup-failure');
  writeState(dir, run);
  const proposal = buildSetupProposal(dir, 'unit', detectTestCapabilities(dir));
  stageTestCapabilitySetup(dir, [proposal], run);

  const result = applyStagedTestCapabilitySetupIfNeeded(dir, run, {
    execFn: () => {
      throw new Error('dependency install failed');
    },
  });

  assert.equal(result.failed, true);
  assert.equal(
    fs.existsSync(path.join(dir, '.engineering-os', 'test-setup-staging', run.id)),
    true
  );
  assert.equal(run.workflow_decisions['unit-setup-failure'].status, 'pending');
  assert.equal(run.test_capability_decisions.unit, 'setup_failed');
});

// --- E2E detection must not require a root config file (real-project regression) ---

function mkE2eRepo(opts = {}) {
  const fsMod = fs;
  const dir = fsMod.mkdtempSync(path.join(os.tmpdir(), 'eos-e2e-detect-'));
  fsMod.mkdirSync(path.join(dir, 'e2e'), { recursive: true });
  fsMod.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({
      name: 'app',
      devDependencies: { '@playwright/test': '^1.62.1', vitest: '^4.0.4' },
      scripts: { test: 'vitest', 'test:e2e': 'playwright test' },
    })
  );
  if (opts.spec !== false) fsMod.writeFileSync(path.join(dir, 'e2e', 'login.spec.ts'), 'x');
  if (opts.rootConfig) fsMod.writeFileSync(path.join(dir, 'playwright.config.ts'), 'export default {}');
  if (opts.nestedConfig) fsMod.writeFileSync(path.join(dir, 'e2e', 'playwright.config.mts'), 'export default {}');
  return dir;
}

test('e2e is available with dep + script + specs even without a root config file', async () => {
  const { detectTestCapabilities, isAutomationAvailable } = await import('./testCapabilities.js');
  const root = mkE2eRepo();
  const caps = detectTestCapabilities(root, {});
  assert.equal(caps.e2e.status, 'available');
  assert.equal(isAutomationAvailable(caps.e2e), true);
  // it must stay honest that no config file was found
  assert.match(caps.e2e.gaps.join(' '), /defaults/i);
});

test('e2e config discovery covers nested directories and .mts/.cts extensions', async () => {
  const { detectTestCapabilities } = await import('./testCapabilities.js');
  const caps = detectTestCapabilities(mkE2eRepo({ nestedConfig: true }), {});
  assert.equal(caps.e2e.status, 'available');
  assert.ok(
    caps.e2e.configPaths.some((p) => p.includes('playwright.config.mts')),
    'nested playwright.config.mts should be discovered'
  );
});

test('e2e is NOT claimed available when there are no spec files to run', async () => {
  const { detectTestCapabilities, isAutomationAvailable } = await import('./testCapabilities.js');
  const caps = detectTestCapabilities(mkE2eRepo({ spec: false }), {});
  assert.notEqual(caps.e2e.status, 'available');
  assert.equal(isAutomationAvailable(caps.e2e), false);
});

// --- A repository that HAS Playwright must never be told it has no E2E framework ------

test('describeE2eUnavailability names the real situation, not a blanket "no framework"', async () => {
  const { describeE2eUnavailability } = await import('./testCapabilities.js');

  const none = describeE2eUnavailability({ status: 'unavailable', framework: null, gaps: [] });
  assert.match(none, /no E2E framework is configured in this repository/);

  const partial = describeE2eUnavailability({
    status: 'partially_configured',
    framework: 'playwright',
    gaps: ['missing e2e script in package.json'],
  });
  assert.match(partial, /does have \*\*Playwright\*\* set up/);
  assert.doesNotMatch(partial, /no E2E framework/i, 'never denies a framework that exists');
  assert.match(partial, /missing e2e script in package\.json/, 'names the actual gap');

  const depsOnly = describeE2eUnavailability({
    status: 'configuration_detected_execution_uncertain',
    framework: 'cypress',
    gaps: ['e2e dependency detected without runnable script/config'],
  });
  assert.match(depsOnly, /\*\*Cypress\*\* is a dependency/);
  assert.doesNotMatch(depsOnly, /no E2E framework/i);
});
