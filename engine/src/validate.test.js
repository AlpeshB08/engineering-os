import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { frameworkHome } from './paths.js';
import { defaultState } from './state.js';
import { validateConsumerState } from './validate.js';

function runtimeState() {
  const state = defaultState();
  state.feature_intake = { title: 'Harden lifecycle' };
  state.test_capabilities = { unit: { status: 'available' } };
  state.completed_runs = [{
    id: 'prior-run',
    workflow_id: 'feature-development',
    status: 'completed',
    artifacts_dir: '/repo/.engineering-os/artifacts/prior-run',
  }];
  state.active_run = {
    id: 'current-run',
    workflow_id: 'feature-development',
    current_phase: 'implement',
    phase_index: 3,
    started_at: new Date().toISOString(),
    artifacts_dir: '/repo/.engineering-os/artifacts/current-run',
    completed_phases: ['bootstrap', 'plan', 'approve'],
    gates: {
      'plan-approval': { status: 'approved', run_id: 'current-run' },
    },
    flags: { architectural_impact: false },
    status: 'active',
    implementation_entered_at: new Date().toISOString(),
    implementation_baseline_ref: 'abc123',
    implementation_baseline_captured_at: new Date().toISOString(),
    blocked: false,
    workflow_decisions: {
      'e2e-automation': {
        id: 'e2e-automation',
        category: 'test_capability',
        status: 'answered',
        question: 'Set up E2E?',
        impact: 'Determines verification mode',
        options: [{ id: 'yes', label: 'Yes' }, { id: 'no', label: 'No' }],
        selectedOption: 'yes',
        required: true,
      },
    },
    orchestration: {
      pipeline: 'pre-approval',
      completed_steps: ['preflight'],
      blockers: [],
      last_error: null,
    },
    test_capability_decisions: { unit: 'approved', e2e: 'declined' },
    test_capability_proposals: [{ kind: 'unit', packages: ['vitest'] }],
    test_capability_setup: { ok: true, mode: 'staged' },
    test_capability_verification: {
      unit: { kind: 'unit', status: 'ready', summary: 'Ready' },
    },
    test_capability_verifications: [{ kind: 'unit', status: 'ready' }],
  };
  return state;
}

test('validateConsumerState accepts synchronized runtime lifecycle fields', () => {
  const result = validateConsumerState(runtimeState());
  assert.deepEqual(result.errors, []);
  assert.equal(result.ok, true);
});

test('state schema declares runtime lifecycle fields', () => {
  const schemaPath = path.join(frameworkHome(), 'engine', 'schemas', 'state.schema.json');
  const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
  const runProperties = schema.$defs.activeRun.properties;
  for (const field of [
    'implementation_entered_at',
    'implementation_baseline_ref',
    'implementation_baseline_captured_at',
    'blocked',
    'workflow_decisions',
    'orchestration',
    'test_capability_decisions',
    'test_capability_setup',
    'test_capability_verification',
    'test_capability_verifications',
    'test_capability_proposals',
  ]) {
    assert.ok(runProperties[field], `schema missing ${field}`);
  }
  assert.ok(schema.$defs.gate.properties.run_id);
  assert.ok(schema.properties.completed_runs);
  assert.ok(schema.properties.feature_intake);
  assert.ok(schema.properties.test_capabilities);
});

test('validateConsumerState rejects unsafe lifecycle and mismatched gate data', () => {
  const state = runtimeState();
  state.active_run.id = '../escape';
  state.active_run.phase_index = -1;
  state.active_run.gates['plan-approval'].run_id = 'another-run';
  state.active_run.blocked = 'false';
  state.active_run.test_capability_decisions.e2e = 'maybe';
  state.completed_runs[0].status = 'active';

  const result = validateConsumerState(state);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /safe run ID/.test(error)));
  assert.ok(result.errors.some((error) => /run_id must match/.test(error)));
  assert.ok(result.errors.some((error) => /phase_index/.test(error)));
  assert.ok(result.errors.some((error) => /blocked must be boolean/.test(error)));
  assert.ok(result.errors.some((error) => /test_capability_decisions\.e2e invalid/.test(error)));
  assert.ok(result.errors.some((error) => /completed_runs\.0\.status invalid/.test(error)));
});

test('validateConsumerState rejects malformed decisions and orchestration', () => {
  const state = runtimeState();
  state.active_run.workflow_decisions['e2e-automation'].options = [{ id: 'yes', label: 'Yes' }];
  state.active_run.orchestration.blockers = [{ type: 'decision', status: 'pending' }];

  const result = validateConsumerState(state);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => /at least two choices/.test(error)));
  assert.ok(result.errors.some((error) => /blockers\.0 invalid/.test(error)));
});
