import test from 'node:test';
import assert from 'node:assert/strict';
import { frameworkHome } from './paths.js';
import {
  canEnterImplement,
  loadWorkflow,
  completePhase,
  advanceRunToPhase,
  startWorkflow,
} from './workflow.js';
import { addBlocker } from './orchestration.js';

test('implement blocked before plan-approval', () => {
  const run = {
    blocked: false,
    gates: { 'plan-approval': { status: 'pending' } },
    orchestration: { blockers: [] },
  };
  const check = canEnterImplement(run);
  assert.equal(check.ok, false);
});

test('implement allowed after plan-approval with run-bound gates', () => {
  const run = {
    blocked: false,
    status: 'active',
    id: 'run-1',
    current_phase: 'approve',
    gates: {
      'plan-approval': { status: 'approved', run_id: 'run-1' },
      'contract-approval': { status: 'approved', run_id: 'run-1' },
    },
    orchestration: { blockers: [] },
    workflow_decisions: {},
  };
  assert.equal(canEnterImplement(run).ok, true);
});

test('pending workflow decisions block implement even with plan approval', () => {
  const run = {
    blocked: false,
    status: 'active',
    current_phase: 'implement',
    id: 'run-1',
    gates: {
      'plan-approval': { status: 'approved', run_id: 'run-1' },
      'contract-approval': { status: 'approved', run_id: 'run-1' },
    },
    orchestration: { blockers: [] },
    workflow_decisions: {
      'backend-dependency': { id: 'backend-dependency', status: 'pending', question: 'Backend?', required: true },
    },
  };
  const check = canEnterImplement(run);
  assert.equal(check.ok, false);
  assert.match(check.reason, /workflow decisions/i);
});

test('BLOCKED run cannot enter implement even with force', () => {
  const run = {
    blocked: false,
    status: 'active',
    id: 'run-blocked',
    gates: {
      'plan-approval': { status: 'approved', run_id: 'run-blocked' },
      'contract-approval': { status: 'approved', run_id: 'run-blocked' },
    },
    orchestration: { blockers: [] },
    workflow_decisions: {},
  };
  addBlocker(run, 'jira', 'incomplete');
  assert.equal(canEnterImplement(run, true).ok, false);

  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const approveIndex = workflow.phases.findIndex((p) => p.id === 'approve');

  const state = {
    active_run: {
      ...run,
      status: 'active',
      workflow_id: 'feature-development',
      phase_index: approveIndex,
      current_phase: 'approve',
      artifacts_dir: '/tmp/artifacts',
      completed_phases: [],
      flags: { architectural_impact: false },
    },
  };

  const result = completePhase({
    frameworkRoot: home,
    eosRoot: '/tmp/.engineering-os',
    state,
    force: true,
  });
  assert.equal(result.ok, false);
});

test('complete-phase --force cannot bypass pending gate approvals', () => {
  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const approveIndex = workflow.phases.findIndex((p) => p.id === 'approve');

  const state = {
    active_run: {
      id: 'run-force-gate',
      status: 'active',
      workflow_id: 'feature-development',
      phase_index: approveIndex,
      current_phase: 'approve',
      artifacts_dir: '/tmp/artifacts',
      completed_phases: [],
      flags: { architectural_impact: false },
      blocked: false,
      gates: {
        'contract-approval': { status: 'approved', run_id: 'run-force-gate' },
        'plan-approval': { status: 'pending' },
      },
      orchestration: { blockers: [] },
      workflow_decisions: {},
    },
  };

  const result = completePhase({
    frameworkRoot: home,
    eosRoot: '/tmp/.engineering-os',
    state,
    force: true,
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /gate approvals cannot be bypassed/i);
});

test('advanceRunToPhase marks skipped phases as completed', () => {
  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const run = {
    id: 'run-advance',
    phase_index: 0,
    current_phase: 'bootstrap',
    completed_phases: [],
    gates: {},
  };
  advanceRunToPhase(run, workflow, 'approve');
  assert.equal(run.current_phase, 'approve');
  assert.ok(run.completed_phases.includes('bootstrap'));
  assert.ok(run.completed_phases.includes('discover'));
  assert.ok(run.completed_phases.includes('contract'));
  assert.ok(run.completed_phases.includes('plan'));
});

test('advanceRunToPhase cannot bypass authoritative implement entry', () => {
  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const run = {
    id: 'run-direct',
    status: 'active',
    phase_index: workflow.phases.findIndex((phase) => phase.id === 'approve'),
    current_phase: 'approve',
    completed_phases: [],
    gates: {},
  };
  assert.throws(
    () => advanceRunToPhase(run, workflow, 'implement'),
    /authoritative entry/i
  );
  assert.equal(run.current_phase, 'approve');
  assert.equal(run.implementation_entered_at, undefined);
});

test('advanceRunToPhase cannot skip verify, review, or deliver', () => {
  const home = frameworkHome();
  const workflow = loadWorkflow(home, 'feature-development');
  const run = {
    id: 'run-skip-verify',
    status: 'active',
    phase_index: workflow.phases.findIndex((phase) => phase.id === 'implement'),
    current_phase: 'implement',
    completed_phases: ['approve'],
    gates: {},
    implementation_entered_at: new Date().toISOString(),
  };
  for (const phase of ['verify', 'review', 'deliver']) {
    assert.throws(
      () => advanceRunToPhase(run, workflow, phase),
      /complete-phase/i
    );
  }
  assert.equal(run.current_phase, 'implement');
});

test('completed or aborted run record must be cleaned up before starting another workflow', () => {
  const home = frameworkHome();
  for (const status of ['completed', 'aborted']) {
    assert.throws(
      () =>
        startWorkflow({
          frameworkRoot: home,
          eosRoot: '/tmp/.engineering-os',
          state: {
            active_run: {
              id: `old-${status}`,
              status,
              workflow_id: 'feature-development',
            },
          },
          workflowId: 'feature-development',
          artifactsBase: '/tmp/artifacts',
        }),
      /clean up or archive/i
    );
  }
});
