import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { captureImplementationBaseline } from './gitChanges.js';
import {
  artifactExists,
  artifactLooksComplete,
  defaultTokens,
  seedRunArtifacts,
  validatePlanBundle,
} from './artifacts.js';
import { fileExists, phasesDir, workflowsDir } from './paths.js';
import { nowIso, slugDate } from './util.js';
import { canEnterImplementPhase, isImplementationPermitted } from './guard.js';
import { applyStagedTestCapabilitySetupIfNeeded } from './intelligence/testCapabilities.js';
import { addBlocker } from './orchestration.js';
import { saveState } from './state.js';
import { DELIVERY_STATUS } from './verificationStates.js';

export function listWorkflows(frameworkRoot) {
  const dir = workflowsDir(frameworkRoot);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => f.replace(/\.ya?ml$/, ''));
}

export function loadWorkflow(frameworkRoot, workflowId) {
  const candidates = [
    path.join(workflowsDir(frameworkRoot), `${workflowId}.yaml`),
    path.join(workflowsDir(frameworkRoot), `${workflowId}.yml`),
  ];
  const file = candidates.find(fileExists);
  if (!file) throw new Error(`Unknown workflow: ${workflowId}`);
  return YAML.parse(fs.readFileSync(file, 'utf8'));
}

export function loadPhaseMarkdown(frameworkRoot, phaseId) {
  const file = path.join(phasesDir(frameworkRoot), `${phaseId}.md`);
  if (!fileExists(file)) {
    return `# Phase: ${phaseId}\n\n(No phase markdown found at ${file})\n`;
  }
  return fs.readFileSync(file, 'utf8');
}

export function currentStep(workflow, run) {
  return workflow.phases[run.phase_index] || null;
}

function ensureGate(run, gateId) {
  if (!run.gates[gateId]) {
    run.gates[gateId] = {
      status: 'pending',
      updated_at: nowIso(),
      note: '',
      run_id: run.id,
    };
  } else if (!run.gates[gateId].run_id) {
    run.gates[gateId].run_id = run.id;
  }
}

export function registerPhaseGates(run, step) {
  for (const g of step.gates || []) ensureGate(run, g);
  for (const g of step.requires_gates || []) ensureGate(run, g);
  for (const g of step.conditional_gates || []) {
    if (run.flags?.architectural_impact) ensureGate(run, g);
  }
}

export function missingArtifacts(run, step, eosRoot, state = null) {
  const missing = [];
  const ctx = state
    ? { intake: state.feature_intake, consumerRoot: path.dirname(eosRoot) }
    : null;
  for (const a of step.required_artifacts || []) {
    if (!artifactExists(run.artifacts_dir, a, eosRoot)) missing.push(a);
    else if (!artifactLooksComplete(run.artifacts_dir, a, eosRoot, ctx)) {
      missing.push(`${a} (incomplete)`);
    }
  }
  return missing;
}

export function pendingRequiredGates(run, step) {
  const pending = [];
  for (const g of step.requires_gates || []) {
    if (run.gates[g]?.status !== 'approved') pending.push(g);
  }
  for (const g of step.conditional_gates || []) {
    if (run.flags?.architectural_impact && run.gates[g]?.status !== 'approved') {
      pending.push(g);
    }
  }
  // Gates declared on this phase must be approved before leaving the phase
  for (const g of step.gates || []) {
    if (run.gates[g]?.status !== 'approved') pending.push(g);
  }
  return [...new Set(pending)];
}

export function startWorkflow({
  frameworkRoot,
  eosRoot,
  state,
  workflowId,
  artifactsBase,
}) {
  if (state.active_run) {
    throw new Error(
      `Run record already exists (${state.active_run.id}, status=${state.active_run.status}, workflow=${state.active_run.workflow_id}). Clean up or archive it before starting a new workflow.`
    );
  }
  const workflow = loadWorkflow(frameworkRoot, workflowId);
  const runId = `${workflowId}-${slugDate()}`;
  const artifactsDir = path.join(artifactsBase, runId);
  fs.mkdirSync(artifactsDir, { recursive: true });

  const tokens = defaultTokens({ runId, workflowId });
  seedRunArtifacts(frameworkRoot, artifactsDir, workflow, tokens);

  // Always ensure decision log exists
  const run = {
    id: runId,
    workflow_id: workflowId,
    current_phase: workflow.phases[0].id,
    phase_index: 0,
    started_at: nowIso(),
    artifacts_dir: artifactsDir,
    completed_phases: [],
    gates: {},
    flags: { architectural_impact: false },
    status: 'active',
  };
  registerPhaseGates(run, workflow.phases[0]);
  state.active_run = run;
  return { state, workflow, run };
}

export function setArchitecturalImpact(run, value) {
  run.flags = run.flags || {};
  run.flags.architectural_impact = Boolean(value);
  if (run.flags.architectural_impact) {
    ensureGate(run, 'architecture-approval');
  }
}

export function completePhase({
  frameworkRoot,
  eosRoot,
  state,
  force = false,
  testSetupOptions = {},
}) {
  const run = state.active_run;
  if (!run || run.status !== 'active') {
    throw new Error('No active workflow run.');
  }
  const workflow = loadWorkflow(frameworkRoot, run.workflow_id);
  const step = currentStep(workflow, run);
  if (!step) throw new Error('Current phase is out of range.');

  registerPhaseGates(run, step);

  const missing = missingArtifacts(run, step, eosRoot, state);
  const pendingGates = pendingRequiredGates(run, step);

  // For gates declared on the phase: require approval before complete
  // Exception: architecture-approval on plan phase is only required when impact=yes
  const blockingGates = pendingGates.filter((g) => {
    if (g === 'architecture-approval' && (step.gates || []).includes(g)) {
      return Boolean(run.flags?.architectural_impact);
    }
    return true;
  });

  if (!force && missing.length) {
    return {
      ok: false,
      missing,
      pendingGates: blockingGates,
      run,
      workflow,
      step,
    };
  }

  if (blockingGates.length) {
    return {
      ok: false,
      missing: force ? missing : [],
      pendingGates: blockingGates,
      reason: 'Required gate approvals cannot be bypassed with --force.',
      run,
      workflow,
      step,
    };
  }

  if (
    run.workflow_id === 'feature-development' &&
    step.id === 'verify' &&
    (
      run.verification_result?.run_id !== run.id ||
      run.verification_result?.status !== DELIVERY_STATUS.READY_FOR_REVIEW
    )
  ) {
    return {
      ok: false,
      missing: ['current-run READY verification result'],
      pendingGates: [],
      reason:
        'Verification must report READY FOR REVIEW for this run before leaving the verify phase. --force cannot bypass verification.',
      run,
      workflow,
      step,
    };
  }

  const nextIndex = run.phase_index + 1;
  const nextPhase = workflow.phases[nextIndex];
  if (nextPhase?.id === 'implement') {
    if (step.id !== 'approve' || run.current_phase !== 'approve') {
      return {
        ok: false,
        reason: 'Implement may only be entered from the approve phase via complete-phase.',
        run,
        workflow,
        step,
      };
    }
    const invalidGate = Object.entries(run.gates || {}).find(([gateId, gate]) => {
      if (gateId === 'architecture-approval' && !run.flags?.architectural_impact) return false;
      if (!gate?.run_id || gate.run_id !== run.id) return true;
      if (gate.status === 'approved') return false;
      if (
        gateId === 'test-capability-setup' &&
        gate.status === 'rejected' &&
        Object.values(run.test_capability_decisions || {}).length > 0 &&
        Object.values(run.test_capability_decisions || {}).every(
          (decision) => decision === 'declined'
        )
      ) {
        return false;
      }
      return true;
    });
    if (invalidGate) {
      return {
        ok: false,
        pendingGates: [invalidGate[0]],
        reason: `Gate ${invalidGate[0]} is pending, rejected, or not bound to this run.`,
        run,
        workflow,
        step,
      };
    }
    const implementCheck = canEnterImplement(run, force);
    if (!implementCheck.ok) {
      return {
        ok: false,
        missing: [],
        pendingGates: ['plan-approval'],
        blocked: run.blocked,
        reason: implementCheck.reason,
        run,
        workflow,
        step,
      };
    }

    const planBundle = validatePlanBundle(run, state, eosRoot);
    if (!planBundle.ok) {
      addBlocker(run, 'plan_bundle', `Plan bundle changed after approval: ${planBundle.issues.join(', ')}`);
      return {
        ok: false,
        missing: planBundle.issues,
        pendingGates: [],
        reason: 'Plan bundle revalidation failed at implementation entry.',
        run,
        workflow,
        step,
      };
    }

    captureImplementationBaseline(path.dirname(eosRoot), run);
    run.phase_index = nextIndex;
    run.current_phase = 'implement';
    run.implementation_entered_at = nowIso();
    registerPhaseGates(run, nextPhase);

    const setupResult = applyStagedTestCapabilitySetupIfNeeded(
      path.dirname(eosRoot),
      run,
      testSetupOptions
    );
    if (setupResult.failed) {
      run.phase_index = nextIndex - 1;
      run.current_phase = 'approve';
      delete run.implementation_entered_at;
      run.test_capability_setup_failure = {
        failed_at: nowIso(),
        setup: setupResult.setup || null,
        verifications: setupResult.verifications || [],
      };
      addBlocker(
        run,
        'test_capability_setup',
        'Approved test capability setup failed. Choose retry setup or explicit Manual QA fallback.'
      );
      saveState(path.dirname(eosRoot), state);
      return {
        ok: false,
        reason:
          'Test capability setup failed; implementation authorization was revoked. Resolve the setup failure decision and retry.',
        setupResult,
        run,
        workflow,
        step,
      };
    }
  }

  if (run.blocked && !force && step.id === 'approve') {
    return {
      ok: false,
      missing: [],
      pendingGates: [],
      blocked: true,
      reason: 'Cannot advance while run is BLOCKED.',
      run,
      workflow,
      step,
    };
  }

  run.completed_phases.push(step.id);
  if (nextIndex >= workflow.phases.length) {
    run.status = 'completed';
    run.current_phase = 'completed';
    return { ok: true, completed: true, run, workflow, step };
  }

  if (nextPhase?.id !== 'implement') {
    run.phase_index = nextIndex;
    run.current_phase = workflow.phases[nextIndex].id;
    registerPhaseGates(run, workflow.phases[nextIndex]);
  }
  return { ok: true, completed: false, run, workflow, step, next: workflow.phases[nextIndex] };
}

export function abortRun(state) {
  if (!state.active_run) throw new Error('No active run.');
  state.active_run.status = 'aborted';
}

export function advanceRunToPhase(run, workflow, phaseId) {
  const idx = workflow.phases.findIndex((p) => p.id === phaseId);
  if (idx < 0) throw new Error(`Unknown phase: ${phaseId}`);

  if (phaseId === 'implement') {
    throw new Error(
      'Cannot advance to implement directly; use complete-phase from approve for authoritative entry.'
    );
  }
  if (['verify', 'review', 'deliver'].includes(phaseId)) {
    throw new Error(
      `Cannot advance to ${phaseId} directly; use complete-phase for the authoritative ${phaseId} transition.`
    );
  }

  const completed = new Set(run.completed_phases || []);
  for (let i = 0; i < idx; i++) {
    completed.add(workflow.phases[i].id);
  }
  run.completed_phases = [...completed];
  run.phase_index = idx;
  run.current_phase = phaseId;
  registerPhaseGates(run, workflow.phases[idx]);
}

export function canEnterImplement(run, _force = false) {
  return canEnterImplementPhase(run);
}
