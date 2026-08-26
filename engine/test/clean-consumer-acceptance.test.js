import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { mkFrontendRepo, runEos, loadState, gitInit } from './helpers/eosCli.js';

/**
 * Clean-consumer acceptance: drive a full /feature lifecycle end-to-end using only
 * the conversational surface (`eos feature` / `eos feature continue`) — no `eos gate`,
 * no `eos complete-phase` — from intake through completion, and assert the artifact
 * lifecycle (temporary artifacts cleaned, durable delivery + permanent metadata kept).
 */

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

function pending(repo) {
  const run = loadState(repo).active_run;
  return Object.values(run?.workflow_decisions || {})
    .filter((d) => d.status === 'pending')
    .map((d) => d);
}

function resolvePlanningDecisions(repo) {
  for (let i = 0; i < 8; i++) {
    const decisions = pending(repo);
    if (!decisions.length) break;
    const d = decisions[0];
    if (d.id === 'e2e-automation') {
      continueTurn(repo, ['--decision', d.id, '--option', 'proceed_without_e2e']);
    } else if (d.id === 'backend-dependency') {
      continueTurn(repo, ['--decision', d.id, '--option', 'fe_only_stub']);
    } else if (d.id.startsWith('clarification:')) {
      continueTurn(repo, ['--decision', d.id, '--answer', 'Feature persists the setting and restores it on reload; invalid input is ignored.']);
    } else if (d.answerType === 'free_text') {
      continueTurn(repo, ['--decision', d.id, '--answer', 'Proceed as specified in the contract.']);
    } else {
      continueTurn(repo, ['--decision', d.id, '--option', d.options[0].id]);
    }
  }
}

function writeRegressionTests(repo) {
  const run = loadState(repo).active_run;
  const regIds = (run?.feature_session?.regression?.cases || [])
    .filter((c) => c.automated)
    .map((c) => c.regId);
  if (!regIds.length) return;
  const dir = path.join(repo, 'src', '__tests__');
  fs.mkdirSync(dir, { recursive: true });
  const body = [
    'import test from "node:test";',
    'import assert from "node:assert";',
    ...regIds.map((id) => `test(${JSON.stringify(id)}, () => assert.ok(true)); // ${id}`),
  ].join('\n');
  fs.writeFileSync(path.join(dir, 'regression.test.js'), `${body}\n`);
}

test('clean consumer: full conversational /feature lifecycle reaches completion and cleans temporary artifacts', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  gitInit(repo);

  const started = runEos(repo, ['feature', '--context', 'Add a dark mode toggle to the settings page that persists the preference to localStorage']);
  assert.equal(started.code, 0, started.stderr || started.stdout);
  const runId = loadState(repo).active_run.id;

  // 1. Clarification + planning decisions, all in-chat.
  resolvePlanningDecisions(repo);
  assert.equal(pending(repo).length, 0, 'all required decisions resolved conversationally');

  // 2. Testing strategy + test cases confirmed in-chat → implement authorized.
  const strat = continueTurn(repo, ['--confirm', 'testing-strategy']);
  assert.equal(strat.code, 0, strat.stderr);
  const cases = continueTurn(repo, ['--confirm', 'test-cases']);
  assert.equal(cases.code, 0, cases.stderr);
  assert.equal(loadState(repo).active_run.current_phase, 'implement');

  // 3. Implement the feature with real source + AC-linked tests (current-run changes).
  fs.writeFileSync(
    path.join(repo, 'src', 'pages', 'Settings.tsx'),
    'export function DarkModeToggle() { return null; }\n'
  );
  const unitDir = path.join(repo, 'src', '__tests__');
  fs.mkdirSync(unitDir, { recursive: true });
  fs.writeFileSync(
    path.join(unitDir, 'darkmode.test.js'),
    [
      'import test from "node:test";',
      'import assert from "node:assert";',
      'test("AC1-T01 happy path", () => assert.ok(true));',
      'test("AC1-T02 edge case", () => assert.ok(true));',
    ].join('\n') + '\n'
  );

  const implemented = continueTurn(repo, [
    '--implemented',
    '--summary',
    'Added DarkModeToggle to the settings page with localStorage persistence',
    '--tests-created',
    'src/__tests__/darkmode.test.js',
  ]);
  assert.equal(implemented.code, 0, implemented.stderr);
  assert.deepEqual(implemented.turn.implementation.blocked_reasons || [], [], 'implementation evidence validated');

  // 4. Drive manual QA / regression / verify / review / delivery to completion.
  let done = false;
  for (let i = 0; i < 12 && !done; i++) {
    const state = loadState(repo);
    if (!state.active_run) {
      done = true;
      break;
    }
    const turn = continueTurn(repo, []).turn || {};
    const stage = turn.stage;
    if (stage === 'manual_qa') {
      continueTurn(repo, ['--confirm', 'manual-qa']);
    } else if (stage === 'regression') {
      writeRegressionTests(repo);
      continueTurn(repo, ['--confirm', 'regression']);
    } else if (stage === 'verify') {
      if (turn.awaiting_kind === 'review') continueTurn(repo, ['--confirm', 'review']);
      else continueTurn(repo, []); // refresh verification
    } else if (stage === 'review' || stage === 'deliver') {
      // Review phase awaits delivery sign-off; deliver phase signs off delivery.
      continueTurn(repo, ['--confirm', 'delivery']);
    } else if (stage === 'complete') {
      done = true;
    } else {
      continueTurn(repo, []);
    }
  }

  // 5. Completion: run finished, durable completion recorded, temporary artifacts cleaned.
  const finalState = loadState(repo);
  assert.equal(finalState.active_run, null, 'active run cleared on completion');
  assert.equal(finalState.last_completion?.run_id, runId, 'durable completion snapshot recorded');
  assert.equal(finalState.last_completion.cleanup.status, 'completed');
  assert.ok(finalState.last_completion.cleanup.removed.length >= 1, 'temporary artifacts were removed');

  // Only the durable delivery record survives in the run artifact directory.
  const runDir = path.join(repo, '.engineering-os', 'artifacts', runId);
  const remaining = fs.existsSync(runDir) ? fs.readdirSync(runDir) : [];
  assert.deepEqual(remaining, ['delivery-preparation.md'], 'only the durable delivery artifact remains');
  assert.match(
    fs.readFileSync(path.join(runDir, 'delivery-preparation.md'), 'utf8'),
    /Feature completion report/
  );

  // Permanent project metadata is preserved.
  assert.ok(fs.existsSync(path.join(repo, '.engineering-os', 'repository-profile.md')));
  assert.ok(fs.existsSync(path.join(repo, '.engineering-os', 'state.json')));
});

test('clean consumer: an incomplete run keeps its artifacts recoverable (no premature cleanup)', () => {
  const repo = mkFrontendRepo();
  runEos(repo, ['init']);
  gitInit(repo);
  runEos(repo, ['feature', '--context', 'Add a dark mode toggle to the settings page that persists the preference to localStorage']);
  const runId = loadState(repo).active_run.id;
  resolvePlanningDecisions(repo);
  continueTurn(repo, ['--confirm', 'testing-strategy']);
  continueTurn(repo, ['--confirm', 'test-cases']);

  // Run is mid-flight (implement), not completed. A cleanup must preserve its artifacts.
  const cleanup = runEos(repo, ['cleanup']);
  assert.equal(cleanup.code, 0, cleanup.stderr);
  const runDir = path.join(repo, '.engineering-os', 'artifacts', runId);
  assert.ok(fs.existsSync(path.join(runDir, 'feature-contract.md')), 'active-run artifacts remain recoverable');
  assert.ok(loadState(repo).active_run, 'active run is still present');
});
