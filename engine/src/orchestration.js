/**
 * Pre-approval orchestration pipeline — resumable, idempotent steps.
 */

export const PRE_APPROVAL_PIPELINE = [
  'preflight',
  'jira_discovery',
  'figma_discovery',
  'feature_contract',
  'plan_intelligence',
  'test_capability',
  'workflow_decisions',
  'plan_bundle_validate',
];

export function initOrchestration(run) {
  run.orchestration = run.orchestration || {
    pipeline: 'pre-approval',
    completed_steps: [],
    blockers: [],
    last_error: null,
  };
  run.blocked = Boolean(run.blocked);
  return run.orchestration;
}

export function isStepComplete(orch, stepId) {
  return orch.completed_steps.includes(stepId);
}

export function markStepComplete(orch, stepId) {
  if (!orch.completed_steps.includes(stepId)) {
    orch.completed_steps.push(stepId);
  }
}

export function addBlocker(run, type, reason) {
  const orch = initOrchestration(run);
  run.blocked = true;
  orch.blockers = orch.blockers.filter((b) => b.type !== type);
  orch.blockers.push({ type, status: 'BLOCKED', reason });
  orch.last_error = reason;
}

export function clearBlockers(run) {
  if (run.orchestration) {
    run.orchestration.blockers = [];
    run.orchestration.last_error = null;
  }
  run.blocked = false;
}

export function clearBlockersByType(run, types = []) {
  if (!run.orchestration) return;
  run.orchestration.blockers = run.orchestration.blockers.filter(
    (blocker) => !types.includes(blocker.type)
  );
  run.blocked = run.orchestration.blockers.length > 0;
  if (!run.blocked) run.orchestration.last_error = null;
}

export function hasBlockers(run) {
  return Boolean(run.blocked) || (run.orchestration?.blockers?.length > 0);
}

export const FEATURE_ORCHESTRATION = {
  bootstrap: {
    steps: [
      { id: 'detect', command: 'eos detect', description: 'Refresh repository capabilities' },
      { id: 'dna-check', command: 'eos intel scan', description: 'Build Project DNA if missing', when: 'dna_missing' },
    ],
  },
  discover: {
    steps: [
      { id: 'jira', command: 'eos intel jira', description: 'Normalize Jira requirements (automatic in eos feature)' },
      { id: 'figma', command: 'eos intel figma --from-json', description: 'Design discovery when Figma URL provided' },
    ],
  },
  plan: {
    steps: [
      { id: 'orchestrate', command: 'eos feature orchestrate-plan', description: 'Plan intelligence bundle (automatic in eos feature)' },
    ],
  },
  approve: {
    steps: [
      { id: 'plan-bundle', command: 'eos feature plan-bundle', description: 'Validate approval bundle' },
      { id: 'plan-approval', command: 'eos feature continue --confirm test-cases', description: 'Conversational plan/test-case confirmation records plan-approval' },
    ],
  },
  verify: {
    steps: [
      { id: 'verify-run', command: 'eos verify run', description: 'Execute capability-gated checks' },
      { id: 'verify-report', command: 'eos verify report', description: 'Generate final verification report' },
    ],
  },
};

export function getOrchestrationSteps(phaseId) {
  return FEATURE_ORCHESTRATION[phaseId]?.steps || [];
}

export function renderOrchestrationManifest(phaseId) {
  const steps = getOrchestrationSteps(phaseId);
  if (!steps.length) return '_No orchestrated steps for this phase._';
  return steps
    .map((s, i) => `${i + 1}. **${s.id}** — ${s.description}${s.command ? `\n   \`${s.command}\`` : ''}`)
    .join('\n');
}
