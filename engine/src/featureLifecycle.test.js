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
