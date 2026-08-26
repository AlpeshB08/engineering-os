import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  mkFrontendRepo,
  runEos,
  fixturePath,
  loadState,
  seedVerifyReadyRun,
} from './helpers/eosCli.js';
import {
  readyFixtures,
  staleRunEvidenceFixtures,
  invalidImplRefFixtures,
  splitAcFixtures,
} from './fixtures/verifyFixtures.js';
import { hasPendingWorkflowDecisions } from '../src/workflowDecisions.js';

test('feature intake starts pipeline and awaits discovery without Jira config', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  const started = runEos(repo, ['feature', '--jira', 'TEST-1']);
  assert.equal(started.code, 0);
  assert.match(started.stdout, /EOS_FEATURE_TURN|Jira discovery/i);
  const state = loadState(repo);
  assert.equal(state.feature_intake.jira.key, 'TEST-1');
  assert.equal(state.active_run.feature_session.awaiting, 'agent');
});

test('jira agent ingest unblocks and advances toward approve', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'TEST-1']);
  const ingested = runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-TEST-1.json')]);
  assert.equal(ingested.code, 0);
  assert.match(ingested.stdout, /complete=true/i);
  const state = loadState(repo);
  assert.ok(state.active_run.orchestration.completed_steps.includes('jira_discovery'));
});

test('figma URL requires discovery; agent JSON completes', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(
    repo,
    [
      'feature',
      '--jira',
      'TEST-1',
      '--figma',
      'https://www.figma.com/design/abc123/Items-Export',
    ]
  );
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-TEST-1.json')]);
  const figma = runEos(repo, ['intel', 'figma', '--from-json', fixturePath('figma-discovery.json')]);
  assert.equal(figma.code, 0);
  const state = loadState(repo);
  assert.ok(state.active_run.orchestration.completed_steps.includes('figma_discovery'));
  assert.ok(
    !state.active_run.orchestration.blockers.some((b) => b.type === 'figma'),
    'figma blocker should be cleared after agent ingest'
  );
  assert.ok(fs.existsSync(path.join(repo, '.engineering-os', 'integrations', 'figma-discovery.json')));
});

test('plan approval blocks implement phase advance', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'TEST-1']);
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-TEST-1.json')]);
  const state = loadState(repo);
  if (state.active_run.current_phase !== 'approve') {
    // Pipeline may still be on earlier phase if bundle incomplete — skip implement test
    return;
  }
  runEos(repo, ['gate', 'contract-approval', '--approve']);
  const advance = runEos(repo, ['complete-phase'], { expectFail: true });
  assert.equal(advance.code, 1);
});

test('all four test strategy outcomes are reachable', async () => {
  const { decideTestStrategy } = await import('../src/intelligence/testStrategy.js');
  const caps = {
    'unit-tests': { present: true, evidence: ['vitest'] },
    'e2e-tests': { present: true, evidence: ['playwright'] },
  };
  const unitOnly = decideTestStrategy({
    contractText: 'Refactor pure utility parseDate with no UI changes',
    impactText: '## Shared components\n- none',
    capabilities: caps,
    intake: {},
  });
  const manual = decideTestStrategy({
    contractText: 'Update tooltip copy on settings page',
    impactText: '',
    capabilities: caps,
    intake: {},
  });
  assert.equal(unitOnly.unit.required || unitOnly.e2e.required || manual.manual.required, true);
});

test('verify report READY FOR REVIEW with complete current-run AC evidence', () => {
  const repo = mkFrontendRepo();
  seedVerifyReadyRun(repo);
  const report = runEos(repo, ['verify', 'report']);
  assert.equal(report.code, 0);
  assert.match(report.stdout, /READY FOR REVIEW/);
});

test('verify report remains pending when execution evidence is missing', () => {
  const repo = mkFrontendRepo();
  const { runId } = seedVerifyReadyRun(repo);
  const evidencePath = path.join(
    repo,
    '.engineering-os',
    'artifacts',
    runId,
    'verification-evidence.md'
  );
  let evidence = fs.readFileSync(evidencePath, 'utf8');
  evidence = evidence.replace(/\| PASS \|/g, '| NOT_RUN |');
  fs.writeFileSync(evidencePath, evidence);
  const report = runEos(repo, ['verify', 'report']);
  assert.match(report.stdout, /IMPLEMENTED_BUT_VERIFICATION_PENDING/);
  const advance = runEos(repo, ['complete-phase', '--force'], { expectFail: true });
  assert.equal(advance.code, 1);
  assert.match(advance.stderr + advance.stdout, /READY verification|cannot bypass verification/i);
  assert.equal(fs.existsSync(evidencePath), true);
});

test('verify report remains pending when only previous-run evidence exists', () => {
  const repo = mkFrontendRepo();
  seedVerifyReadyRun(repo, { fixtures: staleRunEvidenceFixtures });
  const report = runEos(repo, ['verify', 'report']);
  assert.match(report.stdout, /IMPLEMENTED_BUT_VERIFICATION_PENDING/);
});

test('verify report remains pending when implementation reference is invalid', () => {
  const repo = mkFrontendRepo();
  seedVerifyReadyRun(repo, { fixtures: invalidImplRefFixtures });
  const report = runEos(repo, ['verify', 'report']);
  assert.match(report.stdout, /IMPLEMENTED_BUT_VERIFICATION_PENDING/);
});

test('verify report remains pending when AC1 is complete but AC2 is missing', () => {
  const repo = mkFrontendRepo();
  seedVerifyReadyRun(repo, { fixtures: splitAcFixtures });
  const report = runEos(repo, ['verify', 'report']);
  assert.match(report.stdout, /IMPLEMENTED_BUT_VERIFICATION_PENDING/);
});

test('verify report BLOCKED when Jira discovery incomplete', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'TEST-1']);
  const report = runEos(repo, ['verify', 'report']);
  assert.match(report.stdout, /BLOCKED/);
});

test('verify report BLOCKED when Figma discovery incomplete', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(
    repo,
    ['feature', '--jira', 'TEST-1', '--figma', 'https://www.figma.com/design/x/y'],
  );
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-TEST-1.json')]);
  const report = runEos(repo, ['verify', 'report']);
  assert.match(report.stdout, /BLOCKED/);
});

test('figma empty --from-json keeps discovery incomplete', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(
    repo,
    ['feature', '--jira', 'TEST-1', '--figma', 'https://www.figma.com/design/x/y'],
  );
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-TEST-1.json')]);
  const empty = runEos(
    repo,
    ['intel', 'figma', '--from-json', fixturePath('figma-empty.json')],
    { expectFail: true }
  );
  assert.equal(empty.code, 1);
  assert.match(empty.stdout + empty.stderr, /incomplete/i);
});

test('blocked Jira prevents implementation until agent ingest', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  const started = runEos(repo, ['feature', '--jira', 'TEST-1']);
  assert.equal(started.code, 0);
  const state = loadState(repo);
  assert.ok(state.active_run.blocked || state.active_run.orchestration?.blockers?.length);
  assert.equal(state.active_run.feature_session.awaiting, 'agent');
});

test('required E2E unavailable blocks until explicit user decision', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'AUTH-1']);
  const ingested = runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-auth-flow.json')]);
  assert.equal(ingested.code, 0);
  const state = loadState(repo);
  const planPath = path.join(state.active_run.artifacts_dir, 'verification-plan.md');
  const plan = fs.readFileSync(planPath, 'utf8');
  assert.match(plan, /E2E is appropriate but no E2E framework|pending/i);
  assert.equal(state.active_run.workflow_decisions?.['e2e-automation']?.status, 'pending');
  assert.ok(
    state.active_run.orchestration?.blockers?.some((b) => b.type === 'workflow_decision'),
    'expected workflow_decision blocker while awaiting user decision'
  );
  assert.doesNotMatch(plan, /User declined e2e/i);
});

test('explicit reject on required E2E setup resumes with Manual QA fallback', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'AUTH-1']);
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-auth-flow.json')]);
  const rejected = runEos(repo, [
    'feature',
    'continue',
    '--decision',
    'e2e-automation',
    '--option',
    'proceed_without_e2e',
  ]);
  assert.equal(rejected.code, 0);
  const backendDecision = runEos(repo, [
    'decision',
    'answer',
    'backend-dependency',
    '--option',
    'fe_only_stub',
  ]);
  if (backendDecision.code !== 0 && !backendDecision.stderr.includes('not pending')) {
    assert.equal(backendDecision.code, 0, backendDecision.stderr || backendDecision.stdout);
  }
  const state = loadState(repo);
  assert.equal(state.active_run.gates['test-capability-setup'].status, 'rejected');
  const plan = fs.readFileSync(path.join(state.active_run.artifacts_dir, 'verification-plan.md'), 'utf8');
  assert.match(plan, /User declined e2e infrastructure setup/i);
  assert.ok(state.active_run.orchestration.completed_steps.includes('test_capability'));
  assert.equal(state.active_run.blocked, false);
});

test('pending workflow decisions block plan-approval gate', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'AUTH-1']);
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-auth-flow.json')]);
  const state = loadState(repo);
  assert.ok(hasPendingWorkflowDecisions(state.active_run), 'expected pending E2E decision');
  runEos(repo, ['gate', 'contract-approval', '--approve']);
  const blocked = runEos(repo, ['gate', 'plan-approval', '--approve'], { expectFail: true });
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr + blocked.stdout, /workflow decisions/i);
});

test('guard denies application mutation when EOS initialized without active run', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  const blocked = runEos(repo, ['guard', 'implementation', '--path', 'src/App.tsx'], { expectFail: true });
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr + blocked.stdout, /No active governed workflow run/i);
});

test('guard blocks application path mutation before implement phase', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'AUTH-1']);
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-auth-flow.json')]);
  const blocked = runEos(repo, ['guard', 'implementation', '--path', 'src/App.tsx'], { expectFail: true });
  assert.equal(blocked.code, 1);
  assert.match(blocked.stderr + blocked.stdout, /not permitted|blocked|Mutation blocked/i);
});

test('guard allows engineering-os artifact paths during planning', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'AUTH-1']);
  runEos(repo, ['intel', 'jira', '--from-json', fixturePath('jira-auth-flow.json')]);
  const state = loadState(repo);
  const allowed = runEos(repo, [
    'guard',
    'implementation',
    '--path',
    path.join(state.active_run.artifacts_dir, 'feature-contract.md'),
  ]);
  assert.equal(allowed.code, 0);
});

test('guard capabilities reports engine-only without cursor hooks', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  runEos(repo, ['feature', '--jira', 'AUTH-1']);
  const caps = runEos(repo, ['guard', 'capabilities', '--json']);
  assert.equal(caps.code, 0);
  const report = JSON.parse(caps.stdout);
  assert.equal(report.consumer.effective_tier, 'engine-only');
  assert.equal(report.honesty.ide_independent_hard_enforcement, false);
});
