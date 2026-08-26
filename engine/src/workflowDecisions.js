/**
 * Workflow decisions — generic explicit user choices that affect implementation.
 * Persisted in run.workflow_decisions; pending decisions block the workflow.
 */

import fs from 'node:fs';
import { artifactPath } from './artifacts.js';
import { addBlocker } from './orchestration.js';
import { setArchitecturalImpact } from './workflow.js';
import {
  inspectRepositoryEvidence,
  persistEvidenceDiscovery,
  reconcileBackendContext,
} from './intelligence/evidenceDiscovery.js';

export const DECISION_STATUS = {
  PENDING: 'pending',
  ANSWERED: 'answered',
};

/** Well-known decision ids registered by built-in discoverers. Custom ids are supported. */
export const DECISION_IDS = {
  UNIT_AUTOMATION: 'unit-automation',
  UNIT_SETUP_FAILURE: 'unit-setup-failure',
  E2E_AUTOMATION: 'e2e-automation',
  E2E_SETUP_FAILURE: 'e2e-setup-failure',
  BACKEND_DEPENDENCY: 'backend-dependency',
  REQUIREMENT_CLARITY: 'requirement-clarity',
  SOURCE_CONFLICT: 'source-conflict',
  REGRESSION_SCOPE: 'regression-scope',
  ARCHITECTURAL_IMPACT: 'architectural-impact',
};

export const ANSWER_TYPE = {
  CHOICE: 'choice',
  FREE_TEXT: 'free_text',
};

export function validateDecisionSpec(spec = {}) {
  const errors = [];
  if (!spec.id || typeof spec.id !== 'string') errors.push('id is required');
  if (!spec.category || typeof spec.category !== 'string') errors.push('category is required');
  if (!spec.question || typeof spec.question !== 'string') errors.push('question is required');
  if (!spec.impact || typeof spec.impact !== 'string') errors.push('impact is required');
  const answerType = spec.answerType || ANSWER_TYPE.CHOICE;
  if (answerType === ANSWER_TYPE.FREE_TEXT) {
    return { ok: errors.length === 0, errors };
  }
  if (!Array.isArray(spec.options) || spec.options.length < 2) {
    errors.push('options must include at least two choices');
  }
  for (const option of spec.options || []) {
    if (!option?.id || !option?.label) errors.push(`option missing id or label (${option?.id || 'unknown'})`);
  }
  const ids = (spec.options || []).map((o) => o.id);
  if (new Set(ids).size !== ids.length) errors.push('option ids must be unique');
  return { ok: errors.length === 0, errors };
}

export function initWorkflowDecisions(run) {
  run.workflow_decisions = run.workflow_decisions || {};
  return run.workflow_decisions;
}

export function getWorkflowDecision(run, id) {
  return run.workflow_decisions?.[id] || null;
}

export function getPendingDecisions(run) {
  initWorkflowDecisions(run);
  return Object.values(run.workflow_decisions).filter(
    (d) => d.status === DECISION_STATUS.PENDING && d.required !== false
  );
}

export function getAnsweredDecisions(run) {
  initWorkflowDecisions(run);
  return Object.values(run.workflow_decisions).filter((d) => d.status === DECISION_STATUS.ANSWERED);
}

export function hasPendingWorkflowDecisions(run) {
  return getPendingDecisions(run).length > 0;
}

export function registerWorkflowDecision(run, spec = {}) {
  const validation = validateDecisionSpec(spec);
  if (!validation.ok) {
    throw new Error(`Invalid workflow decision "${spec.id || '(unknown)'}": ${validation.errors.join('; ')}`);
  }
  const decisions = initWorkflowDecisions(run);
  const existing = decisions[spec.id];
  if (existing?.status === DECISION_STATUS.ANSWERED) {
    return existing;
  }
  decisions[spec.id] = {
    id: spec.id,
    category: spec.category,
    question: spec.question,
    impact: spec.impact,
    answerType: spec.answerType || ANSWER_TYPE.CHOICE,
    options: (spec.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      description: o.description || '',
      resultingStrategy: o.resultingStrategy || `${spec.question} → ${o.label}`,
    })),
    status: DECISION_STATUS.PENDING,
    selectedOption: null,
    freeTextAnswer: null,
    source: null,
    answeredAt: null,
    resultingStrategy: null,
    note: '',
    required: spec.required !== false,
    createdAt: existing?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    context: spec.context || {},
  };
  return decisions[spec.id];
}

export function unregisterWorkflowDecision(run, id) {
  if (run.workflow_decisions?.[id]?.status === DECISION_STATUS.ANSWERED) return;
  delete run.workflow_decisions?.[id];
}

export function isE2eManualFallbackChosen(run) {
  return isTestCapabilityManualFallbackChosen(run, 'e2e');
}

export function isTestCapabilityManualFallbackChosen(run, kind) {
  const automation = getWorkflowDecision(run, `${kind}-automation`);
  if (
    automation?.status === DECISION_STATUS.ANSWERED &&
    (automation.selectedOption === 'manual_qa' || automation.selectedOption === 'proceed_without_e2e' || automation.selectedOption === 'proceed_without_unit')
  ) {
    return true;
  }
  const failure = getWorkflowDecision(run, `${kind}-setup-failure`);
  if (failure?.status === DECISION_STATUS.ANSWERED && failure.selectedOption === 'manual_qa') {
    return true;
  }
  return run.test_capability_decisions?.[kind] === 'declined';
}

export function isBackendDecisionResolved(run) {
  const decision = getWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY);
  return decision?.status === DECISION_STATUS.ANSWERED;
}

export function getDecisionResultingStrategy(run, id) {
  const decision = getWorkflowDecision(run, id);
  if (decision?.status !== DECISION_STATUS.ANSWERED) return null;
  return decision.resultingStrategy;
}

export function readBackendDependencyContext(artifactsDir) {
  const backendPath = artifactPath(artifactsDir, 'backend-dependency');
  if (!fs.existsSync(backendPath)) {
    return { needsBackend: false, availability: 'unknown', text: '' };
  }
  const text = fs.readFileSync(backendPath, 'utf8');
  const needsBackend = /needs backend per contract heuristics:\s*yes/i.test(text);
  const availabilityMatch = /\*\*Backend availability:\*\*\s*(yes|no|unknown)(?!\s*\|)/i.exec(text);
  return {
    needsBackend,
    availability: availabilityMatch?.[1]?.toLowerCase() || 'unknown',
    text,
    path: backendPath,
  };
}

export function buildDecisionContext(root, state, run, resolved, extra = {}) {
  const artifact = readBackendDependencyContext(run.artifacts_dir);
  const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
  const impactPath = artifactPath(run.artifacts_dir, 'feature-impact');
  const contractText = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, 'utf8') : '';
  const impactText = fs.existsSync(impactPath) ? fs.readFileSync(impactPath, 'utf8') : '';
  const intake = state.feature_intake || {};
  const evidence = inspectRepositoryEvidence({
    root,
    contractText,
    impactText,
    impactSignals: extra.impactSignals,
    intake,
  });
  persistEvidenceDiscovery(run, evidence);
  return {
    resolved,
    backend: reconcileBackendContext(artifact, evidence),
    evidence,
    testCapabilities: resolved?.testCapabilities,
    contractText,
    impactText,
    impactSignals: extra.impactSignals,
    regressionImpact: extra.regressionImpact,
    intake,
    root,
    eosRoot: extra.eosRoot,
  };
}


export function answerWorkflowDecision(
  run,
  decisionId,
  optionId,
  { source = 'user', note = '', resultingStrategy = null, skipImmutabilityCheck = false, freeText = '' } = {}
) {
  const decision = getWorkflowDecision(run, decisionId);
  if (!decision) {
    throw new Error(`Unknown workflow decision: ${decisionId}`);
  }
  if (decision.status === DECISION_STATUS.ANSWERED && !skipImmutabilityCheck) {
    throw new Error(`Decision ${decisionId} is already answered and cannot be changed without explicit override.`);
  }
  const isFreeText = decision.answerType === ANSWER_TYPE.FREE_TEXT || optionId === 'free_text';
  if (isFreeText) {
    const text = String(freeText || note || '').trim();
    if (!text) {
      throw new Error(`Free-text decision ${decisionId} requires an answer.`);
    }
    decision.status = DECISION_STATUS.ANSWERED;
    decision.selectedOption = 'free_text';
    decision.freeTextAnswer = text;
    decision.source = source;
    decision.note = text;
    decision.answeredAt = new Date().toISOString();
    decision.updatedAt = decision.answeredAt;
    decision.resultingStrategy = resultingStrategy || `${decision.question} → ${text}`;
    return decision;
  }
  const option = decision.options.find((o) => o.id === optionId)
    || (optionId === 'manual_qa' && decision.options.find((o) => String(o.id).startsWith('proceed_without')))
    || (optionId === 'setup_e2e' || optionId === 'setup_unit' ? null : null);
  if (!option && (optionId === 'setup_e2e' || optionId === 'setup_unit')) {
    throw new Error(`Installing or configuring ${optionId.replace('setup_', '')} frameworks is not part of the /feature workflow.`);
  }
  if (!option) {
    throw new Error(`Invalid option "${optionId}" for decision ${decisionId}`);
  }
  decision.status = DECISION_STATUS.ANSWERED;
  decision.selectedOption = option.id;
  decision.source = source;
  decision.note = note;
  decision.answeredAt = new Date().toISOString();
  decision.updatedAt = decision.answeredAt;
  decision.resultingStrategy = resultingStrategy || option.resultingStrategy || `${decision.question} → ${option.label}`;
  return decision;
}

export function applyWorkflowDecisionEffects(run, decisionId, optionId, helpers = {}) {
  const { recordTestCapabilityDecision = () => {} } = helpers;
  run.gates = run.gates || {};

  const automationKind = /^(unit|e2e)-automation$/.exec(decisionId)?.[1];
  if (automationKind) {
    const proceedWithout =
      optionId === 'manual_qa' ||
      optionId === `proceed_without_${automationKind}` ||
      optionId === 'proceed_without_e2e' ||
      optionId === 'proceed_without_unit';
    const wait = optionId === 'wait_for_e2e' || optionId === 'wait_for_unit' || optionId === `wait_for_${automationKind}`;
    if (proceedWithout) {
      if (!run.gates['test-capability-setup']) {
        run.gates['test-capability-setup'] = { status: 'pending', updated_at: new Date().toISOString(), note: '', run_id: run.id };
      }
      run.gates['test-capability-setup'].status = 'rejected';
      run.gates['test-capability-setup'].updated_at = new Date().toISOString();
      run.gates['test-capability-setup'].run_id = run.id;
      for (const proposal of run.test_capability_proposals || []) {
        recordTestCapabilityDecision(run, proposal.kind, 'declined');
      }
      recordTestCapabilityDecision(run, automationKind, 'declined');
    } else if (wait) {
      run.flags = run.flags || {};
      run.flags[`${automationKind}_wait_requested`] = true;
    } else if (optionId === `setup_${automationKind}`) {
      throw new Error(`Installing or configuring ${automationKind} frameworks is not part of the /feature workflow.`);
    } else {
      throw new Error(`Invalid option for ${decisionId}: ${optionId}`);
    }
    return;
  }

  const failureKind = /^(unit|e2e)-setup-failure$/.exec(decisionId)?.[1];
  if (failureKind) {
    if (optionId === 'retry_setup') {
      delete run.test_capability_decisions?.[failureKind];
      delete run.test_capability_verification?.[failureKind];
      if (!run.gates['test-capability-setup']) {
        run.gates['test-capability-setup'] = { status: 'pending', updated_at: new Date().toISOString(), note: '', run_id: run.id };
      }
      run.gates['test-capability-setup'].status = 'approved';
      run.gates['test-capability-setup'].updated_at = new Date().toISOString();
      run.gates['test-capability-setup'].run_id = run.id;
      recordTestCapabilityDecision(run, failureKind, 'approved');
    } else if (optionId === 'manual_qa') {
      recordTestCapabilityDecision(run, failureKind, 'declined');
      if (!run.gates['test-capability-setup']) {
        run.gates['test-capability-setup'] = { status: 'pending', updated_at: new Date().toISOString(), note: '', run_id: run.id };
      }
      run.gates['test-capability-setup'].status = 'rejected';
      run.gates['test-capability-setup'].updated_at = new Date().toISOString();
      run.gates['test-capability-setup'].run_id = run.id;
    } else {
      throw new Error(`Invalid option for ${decisionId}: ${optionId}`);
    }
    return;
  }

  if (decisionId === DECISION_IDS.BACKEND_DEPENDENCY) {
    applyBackendDecisionToArtifact(run, { selectedOption: optionId, answeredAt: new Date().toISOString() });
    run.flags = run.flags || {};
    run.flags.backend_dependency_strategy = optionId;
    return;
  }

  if (decisionId === DECISION_IDS.ARCHITECTURAL_IMPACT) {
    setArchitecturalImpact(run, optionId === 'require_architecture_review');
    run.flags = run.flags || {};
    run.flags.architecture_review_decision = optionId;
    return;
  }

  if (decisionId === DECISION_IDS.REGRESSION_SCOPE) {
    run.flags = run.flags || {};
    run.flags.regression_scope_strategy = optionId;
    return;
  }

  if (decisionId === DECISION_IDS.REQUIREMENT_CLARITY) {
    run.flags = run.flags || {};
    run.flags.requirement_clarity_strategy = optionId;
    return;
  }

  if (decisionId === DECISION_IDS.SOURCE_CONFLICT) {
    run.flags = run.flags || {};
    run.flags.source_conflict_strategy = optionId;
    return;
  }
}

export function renderPendingDecisionsMessage(run) {
  const pending = getPendingDecisions(run);
  if (!pending.length) return '';
  const blocks = pending.map((d, index) => {
    const impact = d.impact ? `\n  Impact: ${d.impact}` : '';
    if (d.answerType === ANSWER_TYPE.FREE_TEXT || !d.options?.length) {
      return `${index + 1}. [${d.category}] ${d.question}${impact}\n  Reply in this chat with the missing information.`;
    }
    const options = d.options.map((o, i) => `  ${i + 1}. ${o.label}`).join('\n');
    return `${index + 1}. [${d.category}] ${d.question}${impact}\n${options}`;
  });
  return `Unresolved workflow decisions require explicit user input in this chat:\n\n${blocks.join('\n\n')}\n\nNo response is NOT a decision. Timeout, inactivity, or cancellation remain pending. Do not run a separate CLI command to continue.`;
}

export function renderDecisionAuditSection(run = {}) {
  const decisions = Object.values(run.workflow_decisions || {});
  if (!decisions.length) {
    return `## Workflow decisions

- _(no implementation-affecting decisions recorded for this run)_
`;
  }
  const rows = decisions.map((d) => {
    const selected = d.selectedOption
      ? d.options.find((o) => o.id === d.selectedOption)?.label || d.selectedOption
      : '—';
    return `| ${d.id} | ${d.category} | ${d.status} | ${d.question.replace(/\|/g, '/')} | ${selected} | ${d.source || '—'} | ${d.resultingStrategy || '—'} |`;
  });
  return `## Workflow decisions

| Decision | Category | Status | Question | Selected | Source | Resulting strategy |
|----------|----------|--------|----------|----------|--------|--------------------|
${rows.join('\n')}
`;
}

export function appendDecisionLogEntry(run, decision) {
  if (!run?.artifacts_dir || !decision) return;
  const logPath = artifactPath(run.artifacts_dir, 'decision-log');
  if (!fs.existsSync(logPath)) return;
  let content = fs.readFileSync(logPath, 'utf8');
  const entryId = `D-${String(Object.keys(run.workflow_decisions || {}).length).padStart(3, '0')}`;
  const selected = decision.options.find((o) => o.id === decision.selectedOption);
  const block = `
### ${entryId} — ${decision.id}

- **Date:** ${decision.answeredAt || new Date().toISOString()}
- **Status:** answered
- **Context:** ${decision.question}
- **Impact:** ${decision.impact || '—'}
- **Decision:** ${selected?.label || decision.selectedOption}
- **Consequences:** ${decision.resultingStrategy || 'See verification plan test strategy.'}
- **Approval:** ${decision.source || 'user'} (workflow decision)
`;
  if (content.includes('## Entries')) {
    content = content.replace('## Entries', `## Entries${block}`);
  } else {
    content += `\n## Entries${block}\n`;
  }
  fs.writeFileSync(logPath, content);
}

export function applyBackendDecisionToArtifact(run, decision) {
  if (decision.selectedOption !== 'fe_only_stub') return;
  const backend = readBackendDependencyContext(run.artifacts_dir);
  if (!backend.path) return;
  let text = backend.text;
  if (!text.includes('### Workflow decision')) {
    text += `\n\n### Workflow decision

- **Selected:** FE-only implementation with stubs/mocks
- **Recorded at:** ${decision.answeredAt}
- Stub/mock strategy must be documented before API-dependent implementation proceeds.
`;
    fs.writeFileSync(backend.path, text);
  }
}

export function applyAnsweredDecisionArtifacts(run) {
  applyRequirementClarityToContract(run);
}

export function applyRequirementClarityToContract(run) {
  const decision = getWorkflowDecision(run, DECISION_IDS.REQUIREMENT_CLARITY);
  if (decision?.status !== DECISION_STATUS.ANSWERED) return;
  const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
  if (!fs.existsSync(contractPath)) return;
  let content = fs.readFileSync(contractPath, 'utf8');
  const marker = '### Workflow requirement decisions';
  if (content.includes(marker)) return;
  content += `\n\n${marker}

- **Decision:** ${decision.resultingStrategy}
- **Recorded at:** ${decision.answeredAt}
`;
  fs.writeFileSync(contractPath, content);
}

export function blockForPendingDecisions(run) {
  const pending = getPendingDecisions(run);
  if (!pending.length) return false;
  addBlocker(run, 'workflow_decision', renderPendingDecisionsMessage(run));
  return true;
}

/**
 * Hard pre-implementation gate — returns false when any required decision is pending.
 * Does not mutate run state.
 */
export function canPassDecisionGate(run) {
  const pending = getPendingDecisions(run);
  if (pending.length) {
    return {
      ok: false,
      reason: 'Unresolved workflow decisions require explicit user input.',
      pending,
    };
  }
  return { ok: true, pending: [] };
}

/**
 * Re-evaluate decision gate and sync orchestration blockers with pending state.
 */
export function enforceDecisionGate(run) {
  const check = canPassDecisionGate(run);
  if (!check.ok) {
    blockForPendingDecisions(run);
  }
  return check;
}

export { isImplementationPermitted } from './guard.js';
