import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { listWorkflows, loadWorkflow } from './workflow.js';
import { fileExists, phasesDir, workflowsDir } from './paths.js';

function loadJson(p) {
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function requireKeys(obj, keys, label, errors) {
  for (const k of keys) {
    if (obj[k] === undefined || obj[k] === null || obj[k] === '') {
      errors.push(`${label}: missing required field '${k}'`);
    }
  }
}

const RUN_ID_RE = /^(?!.*\.\.)[A-Za-z0-9][A-Za-z0-9._-]*$/;

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function requireObject(value, label, errors) {
  if (!isObject(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  return true;
}

function validateRunId(id, label, errors) {
  if (typeof id !== 'string' || !RUN_ID_RE.test(id)) {
    errors.push(`${label} must be a safe run ID`);
  }
}

function validateGates(gates, runId, errors) {
  if (!requireObject(gates, 'active_run.gates', errors)) return;
  for (const [id, gate] of Object.entries(gates)) {
    const label = `active_run.gates.${id}`;
    if (!requireObject(gate, label, errors)) continue;
    if (!['pending', 'approved', 'rejected'].includes(gate.status)) {
      errors.push(`${label}.status invalid`);
    }
    if (gate.run_id !== undefined && gate.run_id !== runId) {
      errors.push(`${label}.run_id must match active_run.id`);
    }
  }
}

function validateDecisions(decisions, errors) {
  if (!requireObject(decisions, 'active_run.workflow_decisions', errors)) return;
  for (const [id, decision] of Object.entries(decisions)) {
    const label = `active_run.workflow_decisions.${id}`;
    if (!requireObject(decision, label, errors)) continue;
    requireKeys(decision, ['id', 'category', 'status', 'question', 'impact', 'options', 'required'], label, errors);
    if (decision.id !== id) errors.push(`${label}.id must match its key`);
    if (!['pending', 'answered'].includes(decision.status)) errors.push(`${label}.status invalid`);
    if (!Array.isArray(decision.options) || decision.options.length < 2) {
      errors.push(`${label}.options must contain at least two choices`);
    }
    if (typeof decision.required !== 'boolean') errors.push(`${label}.required must be boolean`);
  }
}

function validateOrchestration(orchestration, errors) {
  if (!requireObject(orchestration, 'active_run.orchestration', errors)) return;
  requireKeys(
    orchestration,
    ['pipeline', 'completed_steps', 'blockers'],
    'active_run.orchestration',
    errors
  );
  if (!Object.hasOwn(orchestration, 'last_error')) {
    errors.push("active_run.orchestration: missing required field 'last_error'");
  }
  if (!Array.isArray(orchestration.completed_steps)) {
    errors.push('active_run.orchestration.completed_steps must be an array');
  }
  if (!Array.isArray(orchestration.blockers)) {
    errors.push('active_run.orchestration.blockers must be an array');
  } else {
    for (const [index, blocker] of orchestration.blockers.entries()) {
      if (!isObject(blocker) || !blocker.type || blocker.status !== 'BLOCKED' || !blocker.reason) {
        errors.push(`active_run.orchestration.blockers.${index} invalid`);
      }
    }
  }
  if (orchestration.last_error !== null && typeof orchestration.last_error !== 'string') {
    errors.push('active_run.orchestration.last_error must be string or null');
  }
}

function validateTestLifecycle(run, errors) {
  if (run.test_capability_decisions !== undefined) {
    if (requireObject(run.test_capability_decisions, 'active_run.test_capability_decisions', errors)) {
      for (const [kind, decision] of Object.entries(run.test_capability_decisions)) {
        if (!['approved', 'declined', 'setup_failed'].includes(decision)) {
          errors.push(`active_run.test_capability_decisions.${kind} invalid`);
        }
      }
    }
  }
  if (
    run.test_capability_proposals !== undefined &&
    (!Array.isArray(run.test_capability_proposals) ||
      run.test_capability_proposals.some((proposal) => !isObject(proposal) || !['unit', 'e2e'].includes(proposal.kind)))
  ) {
    errors.push('active_run.test_capability_proposals invalid');
  }
  if (run.test_capability_setup !== undefined && !isObject(run.test_capability_setup)) {
    errors.push('active_run.test_capability_setup must be an object');
  }
  if (run.test_capability_verification !== undefined) {
    requireObject(run.test_capability_verification, 'active_run.test_capability_verification', errors);
  }
  if (
    run.test_capability_verifications !== undefined &&
    !Array.isArray(run.test_capability_verifications)
  ) {
    errors.push('active_run.test_capability_verifications must be an array');
  }
}

export function validateFramework(frameworkRoot) {
  const errors = [];
  const warnings = [];

  const indexPath = path.join(phasesDir(frameworkRoot), '_index.yaml');
  if (!fileExists(indexPath)) {
    errors.push('phases/_index.yaml missing');
  } else {
    const index = YAML.parse(fs.readFileSync(indexPath, 'utf8'));
    for (const p of index.phases || []) {
      const md = path.join(phasesDir(frameworkRoot), p.file || `${p.id}.md`);
      if (!fileExists(md)) errors.push(`phase file missing: ${md}`);
    }
  }

  const ids = listWorkflows(frameworkRoot);
  if (!ids.length) errors.push('no workflows found');

  for (const id of ids) {
    let wf;
    try {
      wf = loadWorkflow(frameworkRoot, id);
    } catch (e) {
      errors.push(String(e.message || e));
      continue;
    }
    requireKeys(wf, ['id', 'name', 'description', 'phases'], `workflow ${id}`, errors);
    if (wf.id !== id) warnings.push(`workflow file ${id} has id ${wf.id}`);
    if (!Array.isArray(wf.phases) || !wf.phases.length) {
      errors.push(`workflow ${id}: phases empty`);
      continue;
    }
    for (const step of wf.phases) {
      if (!step.id) errors.push(`workflow ${id}: phase missing id`);
      const md = path.join(phasesDir(frameworkRoot), `${step.id}.md`);
      if (!fileExists(md)) errors.push(`workflow ${id}: missing phase markdown for '${step.id}'`);
    }
  }

  for (const schema of [
    'workflow.schema.json',
    'state.schema.json',
    'phase-index.schema.json',
  ]) {
    const p = path.join(frameworkRoot, 'engine', 'schemas', schema);
    if (!fileExists(p)) errors.push(`missing schema ${schema}`);
    else {
      try {
        loadJson(p);
      } catch {
        errors.push(`invalid JSON schema ${schema}`);
      }
    }
  }

  return { ok: errors.length === 0, errors, warnings };
}

export function validateConsumerState(state) {
  const errors = [];
  if (!state) {
    return { ok: false, errors: ['state missing'] };
  }
  if (state.version !== 1) errors.push('unsupported state.version');
  if (typeof state.initialized_at !== 'string' || !state.initialized_at) errors.push('initialized_at missing');
  requireObject(state.capabilities, 'capabilities', errors);
  if (!['unknown', 'frontend', 'backend', 'fullstack', 'monorepo'].includes(state.archetype)) {
    errors.push('archetype invalid');
  }
  if (state.feature_intake !== undefined && state.feature_intake !== null) {
    requireObject(state.feature_intake, 'feature_intake', errors);
  }
  if (state.test_capabilities !== undefined) {
    requireObject(state.test_capabilities, 'test_capabilities', errors);
  }
  if (state.completed_runs !== undefined && !Array.isArray(state.completed_runs)) {
    errors.push('completed_runs must be an array');
  }
  const completedIds = new Set();
  for (const [index, run] of (Array.isArray(state.completed_runs) ? state.completed_runs : []).entries()) {
    const label = `completed_runs.${index}`;
    if (!requireObject(run, label, errors)) continue;
    requireKeys(run, ['id', 'workflow_id', 'status', 'artifacts_dir'], label, errors);
    validateRunId(run.id, `${label}.id`, errors);
    if (!['completed', 'aborted'].includes(run.status)) errors.push(`${label}.status invalid`);
    if (completedIds.has(run.id)) errors.push(`${label}.id duplicates a completed run`);
    completedIds.add(run.id);
  }
  if (state.active_run) {
    const r = state.active_run;
    if (!requireObject(r, 'active_run', errors)) return { ok: false, errors, warnings: [] };
    requireKeys(
      r,
      ['id', 'workflow_id', 'current_phase', 'phase_index', 'artifacts_dir', 'status'],
      'active_run',
      errors
    );
    validateRunId(r.id, 'active_run.id', errors);
    if (!Number.isInteger(r.phase_index) || r.phase_index < 0) errors.push('active_run.phase_index invalid');
    if (!['active', 'completed', 'aborted'].includes(r.status)) errors.push('active_run.status invalid');
    if (r.blocked !== undefined && typeof r.blocked !== 'boolean') errors.push('active_run.blocked must be boolean');
    for (const field of [
      'implementation_entered_at',
      'implementation_baseline_ref',
      'implementation_baseline_captured_at',
    ]) {
      if (r[field] !== undefined && (typeof r[field] !== 'string' || !r[field])) {
        errors.push(`active_run.${field} invalid`);
      }
    }
    if (r.gates !== undefined) validateGates(r.gates, r.id, errors);
    if (r.workflow_decisions !== undefined) validateDecisions(r.workflow_decisions, errors);
    if (r.orchestration !== undefined) validateOrchestration(r.orchestration, errors);
    validateTestLifecycle(r, errors);
  } else if (state.active_run !== null) {
    errors.push('active_run must be object or null');
  }
  return { ok: errors.length === 0, errors, warnings: [] };
}
