import test from 'node:test';
import assert from 'node:assert/strict';
import { canEnterImplement, completePhase, loadWorkflow } from './workflow.js';
import { addBlocker } from './orchestration.js';
import { frameworkHome } from './paths.js';

test('Test 1: plan generated — implement blocked until approval', () => {
  assert.equal(canEnterImplement({ blocked: false, gates: { 'plan-approval': { status: 'pending' } }, orchestration: { blockers: [] } }).ok, false);
});

test('Test 2: no approval recorded — implement blocked', () => {
  assert.equal(canEnterImplement({ blocked: false, gates: {}, orchestration: { blockers: [] } }).ok, false);
});

test('Test 3: valid approval on current run in implement phase — implement allowed', () => {
  assert.equal(
    canEnterImplement({
      id: 'run-101',
      status: 'active',
      current_phase: 'implement',
      blocked: false,
      gates: {
        'plan-approval': { status: 'approved', run_id: 'run-101' },
        'contract-approval': { status: 'approved', run_id: 'run-101' },
      },
      orchestration: { blockers: [] },
      workflow_decisions: {},
    }).ok,
    true
  );
});

test('Test 4: blocked Jira — implement blocked even with plan approval', () => {
  const run = {
    blocked: true,
    gates: { 'plan-approval': { status: 'approved', run_id: 'run-1' } },
    orchestration: { blockers: [{ type: 'jira' }] },
  };
  addBlocker(run, 'jira', 'incomplete');
  assert.equal(canEnterImplement(run, true).ok, false);
});

test('Test 5: blocked Figma — implement blocked', () => {
  const run = {
    blocked: true,
    gates: { 'plan-approval': { status: 'approved' } },
    orchestration: { blockers: [{ type: 'figma' }] },
  };
  assert.equal(canEnterImplement(run).ok, false);
});

test('Test 6: previous-run approval does not authorize current run via gate metadata', () => {
  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const approveIndex = workflow.phases.findIndex((p) => p.id === 'approve');
  const state = {
    active_run: {
      id: 'run-101',
      status: 'active',
      workflow_id: 'feature-development',
      phase_index: approveIndex,
      current_phase: 'approve',
      artifacts_dir: '/tmp/artifacts',
      completed_phases: [],
      flags: { architectural_impact: false },
      blocked: false,
      gates: { 'plan-approval': { status: 'approved', run_id: 'run-100' } },
      orchestration: { blockers: [] },
    },
  };
  const result = completePhase({
    frameworkRoot: home,
    eosRoot: '/tmp/.engineering-os',
    state,
    force: false,
  });
  assert.equal(result.ok, false);
});

test('Test 7: stale contract-approval run_id blocks implement permission', () => {
  assert.equal(
    canEnterImplement({
      id: 'run-101',
      status: 'active',
      current_phase: 'implement',
      blocked: false,
      gates: {
        'plan-approval': { status: 'approved', run_id: 'run-101' },
        'contract-approval': { status: 'approved', run_id: 'run-100' },
      },
      orchestration: { blockers: [] },
      workflow_decisions: {},
    }).ok,
    false
  );
});
