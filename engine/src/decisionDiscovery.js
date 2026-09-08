/**
 * Decision discovery — identify implementation-affecting uncertainty during /feature planning.
 * Registers decisions via the generic workflow_decisions mechanism only when not auto-resolvable.
 */

import fs from 'node:fs';
import path from 'node:path';
import { artifactPath } from './artifacts.js';
import { extractAcceptanceCriteria } from './intelligence/verificationMatrix.js';
import { isAutomationAvailable } from './intelligence/testCapabilities.js';
import { loadNormalizedJira } from './integrations/jira.js';
import { loadFigmaDiscovery } from './integrations/figma.js';
import { isContractSufficient } from './intake.js';
import {
  assessArchitecturalRisk,
  inspectRepositoryEvidence,
  persistEvidenceDiscovery,
  reconcileBackendContext,
  BACKEND_SUPPORT,
} from './intelligence/evidenceDiscovery.js';
import {
  DECISION_IDS,
  DECISION_STATUS,
  ANSWER_TYPE,
  getWorkflowDecision,
  registerWorkflowDecision,
  unregisterWorkflowDecision,
  isTestCapabilityManualFallbackChosen,
  readBackendDependencyContext,
} from './workflowDecisions.js';

const AMBIGUOUS_AC_PATTERNS = [
  /\btbd\b/i,
  /\btbc\b/i,
  /\bto be (determined|confirmed|decided)\b/i,
  /\bunclear\b/i,
  /\bdepends on\b/i,
  /\bif applicable\b/i,
  /\beither .+ or .+\b/i,
  /\b\d+\s*(days|weeks|hours)\s*(or|\/)\s*\d+/i,
  /\?\s*$/,
  /\(placeholder\)/i,
];

const MATERIAL_OPEN_QUESTION_SKIP = [
  /jira discovery incomplete/i,
  /figma design discovery required/i,
  /use agent\/mcp/i,
];

function isMaterialOpenQuestion(text = '') {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return !MATERIAL_OPEN_QUESTION_SKIP.some((p) => p.test(trimmed));
}

export function detectAmbiguousAcceptanceCriteria(contractText = '') {
  const items = extractAcceptanceCriteria(contractText);
  return items
    .map((text, idx) => ({ acId: `AC${idx + 1}`, text }))
    .filter(({ text }) => AMBIGUOUS_AC_PATTERNS.some((p) => p.test(text)));
}

export function detectJiraFigmaConflicts({ intake = {}, contractText = '', root = '', eosRoot = '' }) {
  const conflicts = [];
  if (!intake.jira?.key) return conflicts;

  const jira = loadNormalizedJira(root, intake.jira.key);
  if (!jira) return conflicts;

  for (const question of jira.open_questions || []) {
    if (isMaterialOpenQuestion(question)) {
      conflicts.push({ kind: 'jira_open_question', detail: question });
    }
  }

  if (intake.figma?.url) {
    const figma = loadFigmaDiscovery(root || path.dirname(eosRoot));
    const figmaText = [
      ...(figma?.screens || []),
      ...(figma?.interactions || []),
      figma?.summary || '',
    ]
      .join('\n')
      .toLowerCase();
    const contractLower = contractText.toLowerCase();
    if (figmaText.includes('delete') && contractLower.includes('export') && !contractLower.includes('delete')) {
      conflicts.push({
        kind: 'figma_jira_scope',
        detail: 'Figma interactions suggest destructive flows while contract emphasizes export-only scope.',
      });
    }
    for (const question of figma?.open_questions || []) {
      if (isMaterialOpenQuestion(question)) {
        conflicts.push({ kind: 'figma_open_question', detail: question });
      }
    }
  }

  return conflicts;
}

function slugQuestion(prefix, text, index) {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
  return `${prefix}:${slug || index}`;
}

function isAnswerStillAmbiguous(text = '') {
  return AMBIGUOUS_AC_PATTERNS.some((p) => p.test(text));
}

export function discoverClarificationQuestions(run, context = {}) {
  const contract = context.contractText || '';
  const hasAcSection = /## Acceptance Criteria/i.test(contract);
  const hasIntake = Boolean(
    context.intake?.jira?.key || context.intake?.figma?.url || context.intake?.context
  );
  if ((hasAcSection || hasIntake) && !isContractSufficient(contract)) {
    const id = 'clarification:acceptance-criteria';
    const existing = getWorkflowDecision(run, id);
    if (existing?.status !== DECISION_STATUS.ANSWERED) {
      const source = context.intake?.jira?.key
        ? 'Jira'
        : context.intake?.figma?.url
          ? 'Figma'
          : context.intake?.context
            ? 'the task description'
            : 'the provided intake';
      registerWorkflowDecision(run, {
        id,
        category: 'clarification',
        answerType: ANSWER_TYPE.FREE_TEXT,
        question: `No usable acceptance criteria were found from ${source}. What should this feature do, and how will we know it is done? List concrete, testable requirements. Do not ask the engine to invent them.`,
        impact: 'Implementation cannot start until acceptance criteria exist. Missing requirements will not be assumed.',
        context: { source, kind: 'acceptance-criteria' },
      });
    } else if (isAnswerStillAmbiguous(existing.freeTextAnswer || existing.note || '')) {
      const followId = `${id}:followup`;
      if (getWorkflowDecision(run, followId)?.status !== DECISION_STATUS.ANSWERED) {
        registerWorkflowDecision(run, {
          id: followId,
          category: 'clarification',
          answerType: ANSWER_TYPE.FREE_TEXT,
          question: `The previous acceptance-criteria answer is still too vague ("${existing.freeTextAnswer}"). Provide concrete, testable requirements.`,
          impact: 'Implementation cannot assume missing requirements.',
          context: { parentId: id, kind: 'acceptance-criteria' },
        });
      }
    }
  }

  const ambiguous = detectAmbiguousAcceptanceCriteria(contract);
  for (const { acId, text } of ambiguous) {
    const id = `clarification:${acId.toLowerCase()}`;
    const existing = getWorkflowDecision(run, id);
    if (existing?.status === DECISION_STATUS.ANSWERED) {
      if (isAnswerStillAmbiguous(existing.freeTextAnswer || existing.note || '')) {
        const followId = `${id}:followup`;
        if (getWorkflowDecision(run, followId)?.status !== DECISION_STATUS.ANSWERED) {
          registerWorkflowDecision(run, {
            id: followId,
            category: 'clarification',
            answerType: ANSWER_TYPE.FREE_TEXT,
            question: `Previous answer for ${acId} is still unresolved ("${existing.freeTextAnswer}"). Provide a concrete requirement.`,
            impact: 'Implementation cannot assume missing requirements.',
            context: { acId, parentId: id },
          });
        }
      }
      continue;
    }
    registerWorkflowDecision(run, {
      id,
      category: 'clarification',
      answerType: ANSWER_TYPE.FREE_TEXT,
      question: `Acceptance criterion ${acId} is unresolved: "${text}". What should we implement?`,
      impact: 'This missing requirement must be answered before implementation. Do not assume a default.',
      context: { acId, text },
    });
  }

  const openQuestions = [];
  if (context.intake?.jira?.key && context.root) {
    const jira = loadNormalizedJira(context.root, context.intake.jira.key);
    for (const question of jira?.open_questions || []) {
      if (isMaterialOpenQuestion(question)) openQuestions.push({ source: 'jira', question });
    }
  }
  if (context.intake?.figma?.url) {
    const figma = loadFigmaDiscovery(context.root || '');
    for (const question of figma?.open_questions || []) {
      if (isMaterialOpenQuestion(question)) openQuestions.push({ source: 'figma', question });
    }
  }
  openQuestions.forEach((item, index) => {
    const id = slugQuestion(`clarification:${item.source}`, item.question, index);
    if (getWorkflowDecision(run, id)?.status === DECISION_STATUS.ANSWERED) return;
    registerWorkflowDecision(run, {
      id,
      category: 'clarification',
      answerType: ANSWER_TYPE.FREE_TEXT,
      question: item.question,
      impact: `Unresolved ${item.source} question that affects implementation scope.`,
      context: item,
    });
  });
}

export function discoverRequirementDecisions(run, context = {}) {
  discoverClarificationQuestions(run, context);
  unregisterWorkflowDecision(run, DECISION_IDS.REQUIREMENT_CLARITY);
}

export function discoverSourceConflictDecisions(run, context = {}) {
  const conflicts = detectJiraFigmaConflicts(context).filter((c) => c.kind === 'figma_jira_scope');
  if (!conflicts.length) {
    unregisterWorkflowDecision(run, DECISION_IDS.SOURCE_CONFLICT);
    return;
  }
  if (getWorkflowDecision(run, DECISION_IDS.SOURCE_CONFLICT)?.status === DECISION_STATUS.ANSWERED) {
    return;
  }
  const summary = conflicts.map((c) => c.detail).slice(0, 2).join('; ');
  registerWorkflowDecision(run, {
    id: DECISION_IDS.SOURCE_CONFLICT,
    category: 'requirements',
    question: `Conflicting or unresolved source-of-truth signals were detected: ${summary}`,
    impact: 'This determines which requirement source governs implementation and verification for this feature.',
    options: [
      {
        id: 'jira_authoritative',
        label: 'Jira requirements are authoritative',
        description: 'Implement and verify against Jira acceptance criteria; document Figma deltas separately.',
        resultingStrategy: 'Jira is the authoritative requirement source for this run.',
      },
      {
        id: 'figma_authoritative',
        label: 'Figma/design discovery is authoritative for UI behavior',
        description: 'UI behavior follows Figma discovery; update contract ACs to match before implementation.',
        resultingStrategy: 'Figma/design discovery governs UI behavior for this run.',
      },
      {
        id: 'defer_conflict_resolution',
        label: 'Defer implementation until sources are reconciled',
        description: 'Do not implement conflicting scope until Jira and design sources are aligned.',
        resultingStrategy: 'Implementation deferred until requirement sources are reconciled.',
      },
    ],
    context: { conflicts },
  });
}

export function discoverRegressionDecisions(run, context = {}) {
  const impact = context.regressionImpact || {};
  const candidates = impact.candidates || [];
  const highRiskCount = candidates.filter((c) => c.risk === 'high').length;
  const sharedImpact = candidates.some((c) => c.changedPath !== c.consumerPath);
  const needsDecision =
    candidates.length >= 3 && sharedImpact && highRiskCount >= 1 && candidates.length > highRiskCount + 1;

  if (!needsDecision) {
    unregisterWorkflowDecision(run, DECISION_IDS.REGRESSION_SCOPE);
    return;
  }
  if (getWorkflowDecision(run, DECISION_IDS.REGRESSION_SCOPE)?.status === DECISION_STATUS.ANSWERED) {
    return;
  }

  registerWorkflowDecision(run, {
    id: DECISION_IDS.REGRESSION_SCOPE,
    category: 'regression',
    question: `Shared-component regression impact spans ${candidates.length} consumer areas (${highRiskCount} high-risk). Choose regression scope for this run.`,
    impact: 'This determines which REG scenarios and QA regression scope are required before READY.',
    options: [
      {
        id: 'full_regression_scope',
        label: 'Full regression scope (all identified consumers)',
        description: 'Include REG scenarios for all graph-derived consumer areas.',
        resultingStrategy: 'Full regression scope across all identified shared-component consumers.',
      },
      {
        id: 'focused_high_risk_scope',
        label: 'Focused scope (high-risk consumers only)',
        description: 'Limit automated/manual regression to high-risk consumer flows only; document reduced scope.',
        resultingStrategy: 'Focused regression scope limited to high-risk consumer flows.',
      },
    ],
    context: { candidateCount: candidates.length, highRiskCount },
  });
}

export function discoverArchitecturalDecisions(run, context = {}) {
  const evidence = context.evidence || {};
  const assessment =
    evidence.architecture ||
    assessArchitecturalRisk({
      contractText: context.contractText,
      impactText: context.impactText,
      impactSignals: context.impactSignals,
      sourceText: context.contractText,
    });
  const flagSet = Boolean(run.flags?.architectural_impact);
  run.flags = run.flags || {};

  if (flagSet) {
    unregisterWorkflowDecision(run, DECISION_IDS.ARCHITECTURAL_IMPACT);
    return;
  }
  if (getWorkflowDecision(run, DECISION_IDS.ARCHITECTURAL_IMPACT)?.status === DECISION_STATUS.ANSWERED) {
    return;
  }

  if (!assessment.reviewRequired) {
    run.flags.architecture_review_decision = 'no_architecture_review';
    run.architecture_resolution = {
      status: 'no_review',
      reason: assessment.reason,
      source: 'evidence',
    };
    unregisterWorkflowDecision(run, DECISION_IDS.ARCHITECTURAL_IMPACT);
    return;
  }

  registerWorkflowDecision(run, {
    id: DECISION_IDS.ARCHITECTURAL_IMPACT,
    category: 'architecture',
    question: `A genuine architectural decision is required: ${assessment.reason}. Does this feature require architectural review before implementation?`,
    impact: 'This determines whether architecture-approval gate and expanded review artifacts are required.',
    options: [
      {
        id: 'require_architecture_review',
        label: 'Require architecture review',
        description: 'Treat as architecturally impactful; architecture-approval gate applies.',
        resultingStrategy: 'Architectural review required before implementation proceeds.',
      },
      {
        id: 'no_architecture_review',
        label: 'No architecture review required',
        description: 'Proceed without architecture-approval gate for this feature.',
        resultingStrategy: 'No architecture-approval gate required for this feature.',
      },
    ],
    context: { reason: assessment.reason, impactSignals: context.impactSignals || {} },
  });
}

/**
 * Describe why a test capability is not usable, using the detector's real findings.
 * The workflow must never claim a framework is absent when it is merely incomplete.
 */
function describeCapabilityGap(cap = {}) {
  const gaps = (cap.gaps || []).filter(Boolean);
  if (gaps.length) return gaps.join('; ');
  if (!cap.status || cap.status === 'unavailable') return 'no framework detected';
  return `status: ${cap.status}`;
}

export function discoverTestCapabilityDecisions(run, context = {}) {
  const { resolved = {} } = context;
  const risk = resolved.strategy?.risk || {};
  for (const kind of ['unit', 'e2e']) {
    const label = kind === 'unit' ? 'Unit' : 'E2E';
    const automationId = `${kind}-automation`;
    const failureId = `${kind}-setup-failure`;
    const cap = resolved.testCapabilities?.[kind] || context.testCapabilities?.[kind];
    const required = Boolean(risk[kind]);
    const available = isAutomationAvailable(cap);
    const setupFailed = run.test_capability_decisions?.[kind] === 'setup_failed';

    if (required && !available && !setupFailed) {
      const automationDecision = getWorkflowDecision(run, automationId);
      if (automationDecision?.status !== DECISION_STATUS.ANSWERED) {
        registerWorkflowDecision(run, {
          id: automationId,
          category: 'test_capability',
          question:
            kind === 'e2e'
              ? `E2E is appropriate for this feature but the ${label} setup is not runnable here (${describeCapabilityGap(cap)}). Proceed without E2E using available automated tests and Manual QA?`
              : `${label} automation is appropriate but not runnable here (${describeCapabilityGap(cap)}). Proceed without ${label} using available tests and Manual QA?`,
          impact:
            kind === 'e2e'
              ? 'An E2E framework will not be installed. This decides whether implementation may continue without E2E.'
              : `This determines whether ${label} automation is skipped in favor of Manual QA.`,
          options: [
            {
              id: `proceed_without_${kind}`,
              label: `Proceed without ${label} (available automated tests + Manual QA)`,
              description: `Do not install ${label} infrastructure. Use existing automated tests and Manual QA.`,
              resultingStrategy: `Proceed without ${label} automation; Manual QA covers this gap.`,
            },
            {
              id: `wait_for_${kind}`,
              label: `Do not implement until ${label} is available`,
              description: `Keep implementation blocked until ${label} infrastructure exists.`,
              resultingStrategy: `Implementation deferred until ${label} automation is available.`,
            },
          ],
          context: { kind, available: false, appropriate: true },
        });
      }
      unregisterWorkflowDecision(run, failureId);
    } else {
      unregisterWorkflowDecision(run, automationId);
    }

    if (setupFailed && !isTestCapabilityManualFallbackChosen(run, kind)) {
      if (getWorkflowDecision(run, failureId)?.status !== DECISION_STATUS.ANSWERED) {
        registerWorkflowDecision(run, {
          id: failureId,
          category: 'test_capability',
          question: `${label} setup failed verification. Choose one:`,
          impact: `This determines whether to retry ${label} setup or fall back to Manual QA.`,
          options: [
            {
              id: 'retry_setup',
              label: `Retry ${label} setup`,
              resultingStrategy: `Retry ${label} setup and verification.`,
            },
            {
              id: 'manual_qa',
              label: 'Explicitly fall back to Manual QA',
              resultingStrategy: `Manual QA fallback after ${label} setup failure.`,
            },
          ],
          context: {
            verification: run.test_capability_verification?.[kind] || null,
            setup: run.test_capability_setup || null,
          },
        });
      }
    } else {
      unregisterWorkflowDecision(run, failureId);
    }
  }
}

export function discoverBackendDecisions(run, context = {}) {
  const artifact = context.backend || readBackendDependencyContext(run.artifacts_dir);
  const evidence = context.evidence;
  const backend = evidence
    ? reconcileBackendContext(artifact, evidence)
    : artifact;
  run.flags = run.flags || {};
  const support = backend.support || (
    backend.availability === 'yes'
      ? BACKEND_SUPPORT.SUPPORTED
      : backend.availability === 'no'
        ? BACKEND_SUPPORT.UNSUPPORTED
        : BACKEND_SUPPORT.UNAVAILABLE
  );

  if (support === BACKEND_SUPPORT.SUPPORTED || backend.availability === 'yes') {
    run.flags.backend_support = BACKEND_SUPPORT.SUPPORTED;
    unregisterWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY);
    return;
  }

  if (support === BACKEND_SUPPORT.UNSUPPORTED && backend.inspectable) {
    run.flags.backend_support = BACKEND_SUPPORT.UNSUPPORTED;
    unregisterWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY);
    return;
  }

  if (backend.needsBackend && (support === BACKEND_SUPPORT.UNAVAILABLE || backend.availability === 'unknown')) {
    if (getWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY)?.status !== DECISION_STATUS.ANSWERED) {
      registerWorkflowDecision(run, {
        id: DECISION_IDS.BACKEND_DEPENDENCY,
        category: 'backend',
        question:
          'Backend support for this feature cannot be determined from the repository (unavailable/uninspectable). How should implementation proceed?',
        impact:
          'This determines whether the feature can be fully implemented and verified in the current run.',
        options: [
          {
            id: 'fe_only_stub',
            label: 'Proceed with FE-only support (stubs/mocks)',
            description:
              'Proceed with frontend implementation using documented stub strategy until backend is available.',
            resultingStrategy: 'FE-only implementation with stubs/mocks until backend is available.',
          },
          {
            id: 'wait_for_backend',
            label: 'Wait for backend implementation',
            description: 'Do not implement API-dependent behavior until backend availability is confirmed.',
            resultingStrategy: 'Wait for backend support before API-dependent implementation.',
          },
        ],
        context: { availability: 'unknown', support: BACKEND_SUPPORT.UNAVAILABLE },
      });
    }
    return;
  }

  unregisterWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY);
}

export function discoverImplementationDecisions(run, context = {}) {
  let evidence = context.evidence;
  if (!evidence && context.root) {
    evidence = inspectRepositoryEvidence({
      root: context.root,
      contractText: context.contractText,
      impactText: context.impactText,
      impactSignals: context.impactSignals,
      intake: context.intake,
    });
    persistEvidenceDiscovery(run, evidence);
  }
  const next = {
    ...context,
    evidence,
    backend: evidence ? reconcileBackendContext(context.backend || {}, evidence) : context.backend,
  };
  discoverTestCapabilityDecisions(run, next);
  discoverBackendDecisions(run, next);
  discoverRequirementDecisions(run, next);
  discoverSourceConflictDecisions(run, next);
  discoverRegressionDecisions(run, next);
  discoverArchitecturalDecisions(run, next);
  return run.workflow_decisions;
}

/** @deprecated Use discoverImplementationDecisions */
export function discoverWorkflowDecisions(run, context = {}) {
  return discoverImplementationDecisions(run, context);
}
