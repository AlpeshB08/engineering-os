import test from 'node:test';
import assert from 'node:assert/strict';
import { mkFrontendRepo, runEos, loadState } from './helpers/eosCli.js';

/**
 * Same-chat conversational /feature behavior. Everything here is driven with
 * `eos feature` / `eos feature continue` only — never `eos gate` or a separate
 * CLI approval command — to prove the workflow stays in one active run and never
 * requires the user to resume it out of band.
 */

function startContextFeature(context) {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  const started = runEos(repo, ['feature', '--context', context]);
  assert.equal(started.code, 0, started.stderr || started.stdout);
  return repo;
}

function pendingIds(repo) {
  const run = loadState(repo).active_run;
  return Object.values(run?.workflow_decisions || {})
    .filter((d) => d.status === 'pending')
    .map((d) => d.id);
}

function continueTurn(repo, args, { expectFail = false } = {}) {
  const res = runEos(repo, ['feature', 'continue', ...args, '--json'], { expectFail });
  let turn = null;
  try {
    turn = JSON.parse(res.stdout);
  } catch {
    turn = null;
  }
  return { ...res, turn };
}

test('same-chat: an unresolved required question cannot be auto-answered', () => {
  const repo = startContextFeature('fix login');
  assert.ok(pendingIds(repo).includes('clarification:acceptance-criteria'));
  // No answer supplied → the engine refuses and the decision stays pending.
  const noop = continueTurn(repo, [], { expectFail: true });
  assert.equal(noop.code, 1);
  assert.match(noop.stderr + noop.stdout, /free-text answer is required|required/i);
  assert.ok(pendingIds(repo).includes('clarification:acceptance-criteria'));
  // Implementation is blocked while the required question is open.
  const guard = runEos(repo, ['guard', 'implementation'], { expectFail: true });
  assert.equal(guard.code, 1);
});

test('same-chat: answering a question continues the same run and reveals a newly discovered question', () => {
  const repo = startContextFeature('fix login');
  const runIdBefore = loadState(repo).active_run.id;
  assert.ok(pendingIds(repo).includes('clarification:acceptance-criteria'));

  // Answer the acceptance-criteria question with a still-ambiguous requirement.
  const first = continueTurn(repo, ['--answer', 'The login should work, exact validation rules TBD']);
  assert.equal(first.code, 0, first.stderr);

  // Same active run — no new workflow was started, nothing to "resume".
  assert.equal(loadState(repo).active_run.id, runIdBefore);

  // Re-analysis discovered a NEW clarification question that did not exist before.
  const afterFirst = pendingIds(repo);
  assert.ok(!afterFirst.includes('clarification:acceptance-criteria'), 'answered question is resolved');
  assert.ok(afterFirst.includes('clarification:ac1'), 'newly discovered follow-up question appears');
});

test('same-chat: a newly discovered question blocks progression to implementation', () => {
  const repo = startContextFeature('fix login');
  continueTurn(repo, ['--answer', 'The login should work, exact validation rules TBD']);
  assert.ok(pendingIds(repo).includes('clarification:ac1'));

  // Cannot confirm testing strategy or reach implementation while a required
  // clarification remains open.
  const confirm = continueTurn(repo, ['--confirm', 'testing-strategy'], { expectFail: true });
  assert.equal(confirm.code, 1);
  assert.match(confirm.stderr + confirm.stdout, /unanswered|required/i);
  assert.equal(loadState(repo).active_run.current_phase !== 'implement', true);

  // Answering the follow-up concretely clears the clarification chain.
  const resolved = continueTurn(repo, [
    '--decision',
    'clarification:ac1',
    '--answer',
    'Users log in with email and password; invalid credentials show an inline error.',
  ]);
  assert.equal(resolved.code, 0, resolved.stderr);
  const remaining = pendingIds(repo);
  assert.ok(!remaining.some((id) => id.startsWith('clarification:')), 'no clarification questions remain');
});

test('same-chat: questions are presented one at a time and stay in the chat workflow', () => {
  const repo = startContextFeature('fix login');
  const turn = continueTurn(repo, ['--answer', 'The login should work, exact validation rules TBD']).turn;
  assert.ok(turn, 'turn payload is emitted for the chat');
  // At most one question is surfaced per turn.
  assert.ok(turn.questions.length <= 1);
  // Agent instructions keep the interaction in-chat and forbid auto-answering.
  const instructions = (turn.agent_instructions || []).join(' ');
  assert.match(instructions, /this chat|do not auto-answer/i);
});

test('same-chat: testing strategy and test cases are confirmed in-chat, reaching implement without a separate CLI approval', () => {
  const repo = startContextFeature('Add a dark mode toggle to settings that persists to localStorage');

  // Resolve the standard planning decisions conversationally.
  for (const id of pendingIds(repo)) {
    if (id === 'e2e-automation') continueTurn(repo, ['--decision', id, '--option', 'proceed_without_e2e']);
    else if (id === 'backend-dependency') continueTurn(repo, ['--decision', id, '--option', 'fe_only_stub']);
    else if (id.startsWith('clarification:')) {
      continueTurn(repo, ['--decision', id, '--answer', 'Toggle persists to localStorage and restores on reload.']);
    }
  }
  // Resolve any follow-up clarifications discovered by re-analysis.
  let guardCounter = 0;
  while (pendingIds(repo).some((id) => id.startsWith('clarification:')) && guardCounter++ < 5) {
    const clar = pendingIds(repo).find((id) => id.startsWith('clarification:'));
    continueTurn(repo, ['--decision', clar, '--answer', 'Toggle persists to localStorage and restores on reload.']);
  }

  const strat = continueTurn(repo, ['--confirm', 'testing-strategy']);
  assert.equal(strat.code, 0, strat.stderr);
  assert.equal(strat.turn.stage, 'test_cases');

  const cases = continueTurn(repo, ['--confirm', 'test-cases']);
  assert.equal(cases.code, 0, cases.stderr);

  // Reached the implement phase through the conversation alone — no `eos gate` was run.
  const run = loadState(repo).active_run;
  assert.equal(run.current_phase, 'implement');
  assert.equal(cases.turn.implementation_permitted, true);
  assert.equal(cases.turn.stage, 'implement');
});
