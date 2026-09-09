import test from 'node:test';
import assert from 'node:assert/strict';
import {
  FEATURE_STAGES,
  initFeatureSession,
  isAffirmative,
  matchAnswerToOption,
  canAuthorizeImplementation,
  applyContinueInput,
  evaluateFeatureStage,
  looksLikeTestFile,
} from './featureLifecycle.js';
import { DELIVERY_STATUS } from './verificationStates.js';

test('initFeatureSession starts at intake without confirmations', () => {
  const run = {};
  const session = initFeatureSession(run);
  assert.equal(session.stage, FEATURE_STAGES.INTAKE);
  assert.equal(session.testing.confirmed, false);
  assert.equal(session.testing.test_cases_confirmed, false);
});

test('matchAnswerToOption maps labels, ids, and numbers', () => {
  const decision = {
    options: [
      { id: 'proceed_without_e2e', label: 'Proceed without E2E (available automated tests + Manual QA)' },
      { id: 'wait_for_e2e', label: 'Do not implement until E2E is available' },
    ],
  };
  assert.equal(matchAnswerToOption(decision, 'proceed_without_e2e'), 'proceed_without_e2e');
  assert.equal(matchAnswerToOption(decision, '2'), 'wait_for_e2e');
  assert.equal(matchAnswerToOption(decision, 'wait_for_e2e'), 'wait_for_e2e');
});

test('isAffirmative recognizes explicit confirmation language', () => {
  assert.equal(isAffirmative('confirm'), true);
  assert.equal(isAffirmative('yes'), true);
  assert.equal(isAffirmative('maybe later'), false);
});

test('canAuthorizeImplementation requires testing and test-case confirmation', () => {
  const run = {
    blocked: false,
    orchestration: { blockers: [] },
    workflow_decisions: {},
    feature_session: {
      testing: { confirmed: false, test_cases_confirmed: false, e2e: {} },
    },
  };
  assert.equal(canAuthorizeImplementation(run).ok, false);
  run.feature_session.testing.confirmed = true;
  assert.equal(canAuthorizeImplementation(run).ok, false);
  run.feature_session.testing.test_cases_confirmed = true;
  assert.equal(canAuthorizeImplementation(run).ok, true);
});

test('looksLikeTestFile accepts common test paths and rejects source files', () => {
  assert.equal(looksLikeTestFile('src/auth.test.js'), true);
  assert.equal(looksLikeTestFile('tests/unit/example.spec.ts'), true);
  assert.equal(looksLikeTestFile('src/pages/Auth.tsx'), false);
});

test('--force cannot confirm testing or submit implementation evidence', () => {
  const run = {
    current_phase: 'approve',
    blocked: false,
    orchestration: { blockers: [] },
    workflow_decisions: {},
  };
  const forced = applyContinueInput(run, { force: true, confirm: 'testing-strategy' });
  assert.equal(forced.ok, false);
  assert.match(forced.error, /force/i);
});

test('implementation evidence is rejected outside the implement phase', () => {
  const run = {
    current_phase: 'approve',
    orchestration: { blockers: [] },
    workflow_decisions: {},
  };
  initFeatureSession(run);
  const result = applyContinueInput(run, { implemented: true, summary: 'done' });
  assert.equal(result.ok, false);
  assert.match(result.error, /implement/i);
});

test('evaluateFeatureStage follows YAML verify/review/deliver instead of conversational completion', () => {
  const run = {
    id: 'run-1',
    status: 'active',
    current_phase: 'verify',
    implementation_entered_at: '2026-08-25T00:00:00.000Z',
    verification_result: { run_id: 'run-1', status: DELIVERY_STATUS.READY_FOR_REVIEW },
    orchestration: { blockers: [] },
    workflow_decisions: {},
    feature_session: {
      testing: { confirmed: false, test_cases_confirmed: false, e2e: {} },
      implementation: { summary: 'agent claimed done' },
      regression: { presented: true, confirmed: true, manual: [] },
      completion: { status: 'success' },
    },
  };
  const session = evaluateFeatureStage(run);
  assert.equal(session.stage, FEATURE_STAGES.VERIFY);
  assert.equal(session.awaiting_kind, 'review');
});

test('buildFeatureTurn asks one prioritized question at a time', async () => {
  const { buildFeatureTurn, FEATURE_STAGES } = await import('./featureLifecycle.js');
  const run = {
    id: 'run-q',
    status: 'active',
    current_phase: 'plan',
    blocked: false,
    orchestration: { blockers: [] },
    workflow_decisions: {
      'backend-dependency': {
        id: 'backend-dependency',
        category: 'backend',
        status: 'pending',
        required: true,
        question: 'Backend?',
        impact: 'scope',
        options: [
          { id: 'fe_only_stub', label: 'Stub' },
          { id: 'wait_for_backend', label: 'Wait' },
        ],
      },
      'clarification:ac1': {
        id: 'clarification:ac1',
        category: 'clarification',
        status: 'pending',
        required: true,
        answerType: 'free_text',
        question: 'What is AC1?',
        impact: 'scope',
      },
    },
    feature_session: {
      stage: FEATURE_STAGES.CLARIFICATION,
      awaiting: 'user',
      awaiting_kind: 'questions',
      testing: { confirmed: false, test_cases_confirmed: false, e2e: {}, manual_qa: {} },
      implementation: {},
      regression: { cases: [], case_results: [] },
    },
  };
  const turn = buildFeatureTurn('/tmp', { active_run: run });
  assert.equal(turn.questions.length, 1);
  assert.equal(turn.questions[0].id, 'clarification:ac1');
  assert.equal(turn.remaining_question_count, 2);
});

test('formatTestCasesCopy includes ID, type, preconditions, steps, and expected result', async () => {
  const { formatTestCasesCopy } = await import('./featureLifecycle.js');
  const rendered = formatTestCasesCopy({
    unit: [
      {
        id: 'AC1-T01',
        type: 'unit',
        description: 'Hide completed todos',
        preconditions: 'TaskList is rendered.',
        steps: ['Set hideCompleted true'],
        expected: 'Completed rows are hidden.',
      },
    ],
  });
  assert.match(rendered, /\*\*ID:\*\* AC1-T01/);
  assert.match(rendered, /\*\*Type:\*\* unit/);
  assert.match(rendered, /\*\*Preconditions:\*\*/);
  assert.match(rendered, /\*\*Steps:\*\*/);
  assert.match(rendered, /\*\*Expected result:\*\*/);
});

test('buildFeatureTurn renders the completion report after cleanup instead of no active run', async () => {
  const { buildFeatureTurn, renderCompletionReport } = await import('./featureLifecycle.js');
  const completion = {
    run_id: 'run-done',
    implementation: { summary: 'Shipped logout', files_changed: ['src/Logout.tsx'] },
    unit: { cases: ['AC1-T01: logout'], results: [{ name: 'unit tests', status: 'Passed' }] },
    e2e: { applicable: false, cases: [], results: [] },
    manual_qa: { applicable: true, confirmed: true, cases: ['AC1-M01'] },
    regression: {
      cases: [{ regId: 'REG-001', description: 'REG-001: existing header' }],
      case_results: [{ regId: 'REG-001', status: 'Passed', testReference: 'src/regression.test.js', evidence: 'Current-run regression execution passed' }],
    },
    verification: { status: 'READY FOR REVIEW' },
    review: { status: 'confirmed' },
    delivery: { status: 'signed-off' },
    unresolved: [],
    cleanup: { status: 'completed', removed: ['a'], preserved: ['b'], errors: [] },
  };
  const turn = buildFeatureTurn('/tmp', { active_run: null, last_completion: completion });
  assert.match(turn.message, /Feature completion report/);
  assert.doesNotMatch(turn.message, /No active feature run/);
  assert.match(renderCompletionReport(completion), /Manual QA status/);
  assert.match(renderCompletionReport(completion), /Cleanup result/);
});

test('listCurrentRunTestFiles finds regression tests added after implement in non-git repos', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { listCurrentRunTestFiles } = await import('./featureLifecycle.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-reg-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  const enteredAt = new Date(Date.now() - 60_000).toISOString();
  const run = {
    implementation_entered_at: enteredAt,
    feature_session: {
      implementation: { tests_created: ['src/feature.test.js'] },
    },
  };
  fs.writeFileSync(path.join(root, 'src/feature.test.js'), 'test("AC1-T01", () => {});\n');
  fs.writeFileSync(path.join(root, 'src/regression.test.js'), 'test("REG-001", () => {});\n');
  const files = listCurrentRunTestFiles(root, run);
  assert.ok(files.includes('src/feature.test.js'));
  assert.ok(files.includes('src/regression.test.js'));
});


test('test cases are still listed when the repository has no usable test runner', async () => {
  const os = await import('node:os');
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { collectTestCases, formatTestCasesCopy } = await import('./featureLifecycle.js');

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-cases-'));
  const artifactsDir = path.join(root, 'artifacts', 'run-1');
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, 'feature-contract.md'),
    '# Contract\n\n## Acceptance Criteria\n\n1. User can toggle dark mode and the choice persists.\n'
  );
  const run = { id: 'run-1', artifacts_dir: artifactsDir };

  // No automation available anywhere: nothing is "required", but the copy-paste list
  // must still be produced so the user can run the cases manually.
  const cases = collectTestCases(run, {
    strategy: {
      unit: { required: false },
      e2e: { required: false },
      manual: { required: true },
    },
  });

  assert.ok(cases.unit.length >= 4, `expected unit cases without a runner, got ${cases.unit.length}`);
  assert.ok(cases.manual.length >= 1, 'expected manual cases');
  const rendered = formatTestCasesCopy(cases);
  assert.match(rendered, /AC1-T01/);
  assert.match(rendered, /negative/i);
  assert.match(rendered, /edge/i);
  assert.match(rendered, /error/i);
});

// --- Large test-case sets are summarised, and the full list is always on disk ---

function mkCases(unitCount) {
  const mk = (i, type, prefix) => ({
    id: `AC${Math.ceil((i + 1) / 4)}-${prefix}${String(i + 1).padStart(2, '0')}`,
    type,
    description: `${type} case ${i + 1}`,
    preconditions: 'p',
    steps: ['s'],
    expected: 'e',
  });
  return {
    unit: Array.from({ length: unitCount }, (_, i) => mk(i, 'unit', 'T')),
    e2e: [],
    manual: [mk(0, 'manual', 'M')],
    extra: [],
  };
}

test('countTestCases totals every group', async () => {
  const { countTestCases } = await import('./featureLifecycle.js');
  const counts = countTestCases(mkCases(20));
  assert.equal(counts.unit, 20);
  assert.equal(counts.manual, 1);
  assert.equal(counts.total, 21);
});

test('formatTestCasesSummary reports shape and points at the full list', async () => {
  const { formatTestCasesSummary } = await import('./featureLifecycle.js');
  const out = formatTestCasesSummary(mkCases(20), { artifactPath: '.engineering-os/x/test-cases.md' });
  assert.match(out, /21 proposed \(summary\)/);
  assert.match(out, /\.engineering-os\/x\/test-cases\.md/);
  assert.match(out, /\| Unit \| 20 \|/);
  assert.match(out, /Per acceptance criterion/);
  // it must not dump every case inline
  assert.ok(out.length < 4000, 'summary should stay compact');
});

test('persistConfirmedTestCases can write a pre-confirmation draft', async () => {
  const os = await import('node:os');
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const { persistConfirmedTestCases } = await import('./featureLifecycle.js');

  const dir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'eos-cases-persist-'));
  const run = { id: 'run-1', artifacts_dir: dir, feature_session: undefined };
  const session = { testing: { test_cases: mkCases(3) } };

  const draft = persistConfirmedTestCases(run, session, { confirmed: false });
  const draftText = fsMod.readFileSync(draft, 'utf8');
  assert.match(draftText, /Proposed test cases \(awaiting confirmation\)/);
  assert.match(draftText, /EOS_ARTIFACT_STATUS: draft/);
  assert.match(draftText, /AC1-T01/, 'the full list is written to disk');

  const confirmed = persistConfirmedTestCases(run, session, { confirmed: true });
  const confirmedText = fsMod.readFileSync(confirmed, 'utf8');
  assert.match(confirmedText, /# Confirmed test cases/);
  assert.match(confirmedText, /EOS_ARTIFACT_STATUS: approved/);
});

test('completion report names checks that did not actually run', async () => {
  const { renderCompletionReport } = await import('./featureLifecycle.js');
  const report = renderCompletionReport({
    run_id: 'r1',
    implementation: { summary: 's', files_changed: [] },
    checks: [
      { name: 'unit tests', status: 'Passed', command: 'npm test' },
      { name: 'e2e', status: 'Infrastructure Failed', failureSummary: 'browsers missing', command: 'npm run test:e2e' },
    ],
    regression: { cases: [], case_results: [] },
    cleanup: { status: 'completed', removed: [], preserved: [], errors: [] },
  });
  assert.match(report, /### Not executed \(limitations\)/);
  assert.match(report, /e2e.*Infrastructure Failed.*browsers missing/s);
  assert.doesNotMatch(report.split('Not executed (limitations)')[1].split('###')[0], /unit tests/);
});

test('completion report names a skipped E2E as not executed, not as full coverage', async () => {
  const { renderCompletionReport } = await import('./featureLifecycle.js');
  const report = renderCompletionReport({
    run_id: 'r2',
    implementation: { summary: 's', files_changed: [] },
    // Fix 1 skips the e2e check entirely when the strategy does not require it, so it
    // never reaches `checks` — the strategy is the only record that it did not run.
    checks: [{ name: 'unit tests', status: 'Passed', command: 'npm test' }],
    e2e: { applicable: true, available: false, executed: false, user_decision: 'proceed_without_e2e', cases: [] },
    manual_qa: { applicable: true, confirmed: false, cases: [], case_results: [] },
    regression: { cases: [{ regId: 'REG-001', description: 'x' }], case_results: [] },
    cleanup: { status: 'completed', removed: [], preserved: [], errors: [] },
  });
  const section = report.split('### Not executed (limitations)')[1].split('###')[0];
  assert.doesNotMatch(section, /every applicable check ran/);
  assert.match(section, /\*\*E2E\*\*: Not executed/);
  assert.match(section, /proceed_without_e2e/);
  assert.match(section, /\*\*Manual QA\*\*: Not confirmed/);
  assert.match(section, /\*\*Regression\*\*: 1 case\(s\) generated with no recorded evidence/);
});

test('completion report still reports full coverage when everything ran', async () => {
  const { renderCompletionReport } = await import('./featureLifecycle.js');
  const report = renderCompletionReport({
    run_id: 'r3',
    implementation: { summary: 's', files_changed: [] },
    checks: [{ name: 'unit tests', status: 'Passed', command: 'npm test' }],
    e2e: { applicable: false, available: false, executed: false, cases: [] },
    manual_qa: { applicable: true, confirmed: true, cases: [], case_results: [{ id: 'AC1-M01' }] },
    regression: { cases: [], case_results: [] },
    cleanup: { status: 'completed', removed: [], preserved: [], errors: [] },
  });
  const section = report.split('### Not executed (limitations)')[1].split('###')[0];
  assert.match(section, /None — every applicable check ran/);
});

// --- The list shown must be the list confirmed --------------------------------------

const CONFIRMED_STRATEGY = {
  unit: { required: true },
  e2e: { required: false },
  manual: { required: true },
  signals: {},
  strategy_label: 'Unit only',
};

async function mkTestCaseRun() {
  const fsMod = await import('node:fs');
  const os = await import('node:os');
  const pathMod = await import('node:path');
  const dir = fsMod.mkdtempSync(pathMod.join(os.tmpdir(), 'eos-cases-turn-'));
  fsMod.writeFileSync(
    pathMod.join(dir, 'feature-contract.md'),
    '# Feature Contract\n\n## Acceptance Criteria\n\n1. An admin can invite a member and assign a role.\n',
  );
  return {
    id: 'run-cases',
    current_phase: 'plan',
    artifacts_dir: dir,
    orchestration: { blockers: [] },
    workflow_decisions: {},
    gates: {},
    feature_session: {
      testing: {
        strategy: CONFIRMED_STRATEGY,
        confirmed: true,
        test_cases: [], // the legacy/default empty shape that produced "None" everywhere
        test_cases_confirmed: false,
        manual_qa: { required: true, cases: [], confirmed: false },
      },
    },
  };
}

test('test cases render from the confirmed strategy even with no resolution context', async () => {
  const { buildFeatureTurn } = await import('./featureLifecycle.js');
  const run = await mkTestCaseRun();

  // resolved === null is the path the CLI takes on a bare `eos feature continue`.
  const turn = buildFeatureTurn('/tmp', { active_run: run }, null);

  assert.equal(turn.stage, 'test_cases');
  assert.doesNotMatch(turn.message, /None for this strategy/, 'the list is not empty');
  assert.match(turn.message, /AC1-T01/);
  assert.match(turn.message, /AC-PERMISSIONS/, 'the extra coverage cases are shown too');
});

test('an empty test-case list cannot be confirmed into implementation', async () => {
  const { applyContinueInput } = await import('./featureLifecycle.js');
  const run = await mkTestCaseRun();
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  // A contract with no acceptance criteria yields no cases at all.
  fsMod.writeFileSync(pathMod.join(run.artifacts_dir, 'feature-contract.md'), '# Feature Contract\n');
  run.feature_session.testing.strategy = CONFIRMED_STRATEGY;

  const result = applyContinueInput(run, { confirm: 'test-cases' });
  assert.equal(result.ok, false);
  assert.match(result.error, /nothing meaningful to confirm/i);
  assert.equal(run.feature_session.testing.test_cases_confirmed, false, 'implementation stays locked');
});

test('confirmation is refused when the reviewed list no longer matches', async () => {
  const { buildFeatureTurn, applyContinueInput } = await import('./featureLifecycle.js');
  const fsMod = await import('node:fs');
  const pathMod = await import('node:path');
  const run = await mkTestCaseRun();

  buildFeatureTurn('/tmp', { active_run: run }, null); // writes the draft artifact

  // The contract gains an acceptance criterion after the user reviewed the list.
  fsMod.writeFileSync(
    pathMod.join(run.artifacts_dir, 'feature-contract.md'),
    '# Feature Contract\n\n## Acceptance Criteria\n\n1. An admin can invite a member and assign a role.\n2. An invited member completes onboarding.\n',
  );

  const stale = applyContinueInput(run, { confirm: 'test-cases' });
  assert.equal(stale.ok, false);
  assert.match(stale.error, /do not match/i);
  assert.equal(run.feature_session.testing.test_cases_confirmed, false);

  // The refreshed list was saved, so confirming again now succeeds.
  const retry = applyContinueInput(run, { confirm: 'test-cases' });
  assert.equal(retry.ok, true);
  assert.equal(run.feature_session.testing.test_cases_confirmed, true);
});

test('the completion report keeps the extra coverage cases', async () => {
  const { renderCompletionReport } = await import('./featureLifecycle.js');
  const report = renderCompletionReport({
    run_id: 'r4',
    implementation: { summary: 's', files_changed: [] },
    checks: [{ name: 'unit tests', status: 'Passed', command: 'npm test' }],
    unit: { cases: [{ id: 'AC1-T01', type: 'unit', description: 'happy path', steps: ['arrange'], preconditions: 'p', expected: 'e' }], results: [] },
    extra_cases: [{ id: 'AC-PERMISSIONS', type: 'unit', description: 'denies unauthorized access', steps: ['arrange'], preconditions: 'p', expected: 'e' }],
    manual_qa: { applicable: true, confirmed: true, cases: [], case_results: [{ id: 'm' }] },
    regression: { cases: [], case_results: [] },
    cleanup: { status: 'completed', removed: [], preserved: [], errors: [] },
  });
  assert.match(report, /AC-PERMISSIONS/, 'extra coverage survives into the durable record');
});
