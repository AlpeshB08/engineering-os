/**
 * Conversational /feature overlay for same-chat intake, questions, and
 * confirmations. YAML workflow phases remain the source of truth.
 *
 * Authoritative lifecycle:
 *   approve → implement → verify → review → deliver
 * via `completePhase` only. This module never marks those phases complete
 * from an agent report, never auto-answers, and never auto-approves.
 */

import fs from 'node:fs';
import path from 'node:path';
import { artifactPath, markArtifactStatus } from './artifacts.js';
import { executeCleanup } from './cleanup.js';
import { getImplementationChangedFiles } from './gitChanges.js';
import { detectConsumerEnforcement } from './mutationEnforcement.js';
import { isAutomationAvailable } from './intelligence/testCapabilities.js';
import {
  decideRegressionStrategy,
  generateQaRegressionScope,
  generateRegressionScenarios,
  applyRegressionSectionsToPlan,
  renderRegressionStrategySection,
  renderRegressionScenariosSection,
  renderQaRegressionScopeSection,
  renderRegressionImpactGraph,
} from './intelligence/regressionImpact.js';
import {
  generateE2eScenarios,
  generateManualScenarios,
  generateUnitScenarios,
} from './intelligence/testStrategy.js';
import { addBlocker, clearBlockersByType, hasBlockers } from './orchestration.js';
import { eosDir } from './paths.js';
import { nowIso } from './util.js';
import { DELIVERY_STATUS } from './verificationStates.js';
import { cmdVerifyReport, cmdVerifyRun, runEngineeringChecks } from './verify.js';
import { advanceRunToPhase, completePhase, loadWorkflow } from './workflow.js';
import {
  DECISION_STATUS,
  answerWorkflowDecision,
  applyAnsweredDecisionArtifacts,
  applyWorkflowDecisionEffects,
  appendDecisionLogEntry,
  getPendingDecisions,
  getWorkflowDecision,
  hasPendingWorkflowDecisions,
} from './workflowDecisions.js';
import { canEnterImplementPhase, isImplementationPermitted } from './guard.js';
import { detectCapabilities } from './detect.js';
import { detectTestCapabilities } from './intelligence/testCapabilities.js';
import { extractAcceptanceCriteria } from './intelligence/verificationMatrix.js';
import {
  parseImplementationReferences,
  verifyRepositoryReference,
} from './requirementVerification.js';
import { saveState, loadState } from './state.js';
import {
  isContractSufficient,
  replaceAcceptanceCriterion,
  splitAnswerIntoCriteria,
  writeAcceptanceCriteria,
} from './intake.js';

export const FEATURE_STAGES = {
  INTAKE: 'intake',
  CLARIFICATION: 'clarification',
  TESTING_STRATEGY: 'testing_strategy',
  TEST_CASES: 'test_cases',
  IMPLEMENT: 'implement',
  MANUAL_QA: 'manual_qa',
  REGRESSION: 'regression',
  VERIFY: 'verify',
  REVIEW: 'review',
  DELIVER: 'deliver',
  COMPLETE: 'complete',
};

export const AWAITING = {
  USER: 'user',
  AGENT: 'agent',
  NONE: null,
};

const TEST_CAPABILITY_CATEGORIES = new Set(['test_capability']);
const AFFIRMATIVE = /^(y|yes|ok|okay|confirm|confirmed|approve|approved|proceed|lgtm|looks good|agree|ship it)\b/i;
const NEGATIVE = /^(n|no|wait|stop|reject|rejected|decline|not yet|hold)\b/i;
const IMPLEMENTATION_EVIDENCE_BLOCKERS = ['required_tests', 'regression', 'verification', 'review', 'delivery'];

export function initFeatureSession(run) {
  run.feature_session = run.feature_session || {
    stage: FEATURE_STAGES.INTAKE,
    awaiting: AWAITING.NONE,
    awaiting_kind: null,
    conversation: [],
    testing: {
      strategy: null,
      confirmed: false,
      confirmed_at: null,
      e2e: {
        appropriate: false,
        available: false,
        proposed: false,
        user_decision: null,
        executed: false,
      },
      test_cases: [],
      test_cases_confirmed: false,
      test_cases_confirmed_at: null,
      manual_qa: {
        required: false,
        cases: [],
        presented: false,
        confirmed: false,
        confirmed_at: null,
      },
      automated_coverage: [],
    },
    implementation: {
      authorized: false,
      summary: null,
      tests_created: [],
      automated_results: null,
      blocked_reasons: [],
    },
    regression: {
      cases: [],
      manual: [],
      presented: false,
      confirmed: false,
      confirmed_at: null,
      automated_results: [],
      case_results: [],
    },
    completion: null,
  };
  const session = run.feature_session;
  // Sessions are persisted across CLI turns, so make additions backwards-compatible
  // with runs created before these fields existed.
  session.testing = session.testing || {};
  session.testing.e2e = session.testing.e2e || {};
  session.testing.manual_qa = session.testing.manual_qa || {
    required: false,
    cases: [],
    presented: false,
    confirmed: false,
    confirmed_at: null,
  };
  session.testing.automated_coverage = session.testing.automated_coverage || [];
  session.implementation = session.implementation || {
    authorized: false,
    summary: null,
    tests_created: [],
    automated_results: null,
    blocked_reasons: [],
  };
  session.regression = session.regression || {};
  session.regression.cases = session.regression.cases || [];
  session.regression.manual = session.regression.manual || [];
  session.regression.automated_results = session.regression.automated_results || [];
  session.regression.case_results = session.regression.case_results || [];
  return session;
}

export function recordConversation(session, entry) {
  session.conversation = session.conversation || [];
  session.conversation.push({
    at: nowIso(),
    ...entry,
  });
}

export function isAffirmative(text = '') {
  return AFFIRMATIVE.test(String(text).trim());
}

export function isNegative(text = '') {
  return NEGATIVE.test(String(text).trim());
}

export function matchAnswerToOption(decision, text = '') {
  const raw = String(text).trim();
  if (!raw || !decision?.options?.length) return null;
  const lower = raw.toLowerCase();
  const byId = decision.options.find((o) => o.id.toLowerCase() === lower);
  if (byId) return byId.id;
  const byLabel = decision.options.find((o) => o.label.toLowerCase() === lower);
  if (byLabel) return byLabel.id;
  const numbered = raw.match(/^(\d+)[.)]?\s*$/);
  if (numbered) {
    const idx = Number(numbered[1]) - 1;
    if (decision.options[idx]) return decision.options[idx].id;
  }
  const contained = decision.options.filter(
    (o) => lower.includes(o.id.toLowerCase()) || lower.includes(o.label.toLowerCase())
  );
  if (contained.length === 1) return contained[0].id;
  return null;
}

function blockerTypes(run) {
  return new Set((run.orchestration?.blockers || []).map((b) => b.type));
}

const QUESTION_PRIORITY = {
  clarification: 0,
  requirements: 1,
  backend: 2,
  architecture: 3,
  regression: 4,
  test_capability: 5,
};

function questionPriority(decision = {}) {
  if (String(decision.id || '').startsWith('clarification:')) return 0;
  return QUESTION_PRIORITY[decision.category] ?? 9;
}

function sortQuestions(questions = []) {
  return [...questions].sort((a, b) => {
    const delta = questionPriority(a) - questionPriority(b);
    if (delta !== 0) return delta;
    return String(a.id || '').localeCompare(String(b.id || ''));
  });
}

function clarificationPending(run) {
  return sortQuestions(getPendingDecisions(run).filter((d) => !TEST_CAPABILITY_CATEGORIES.has(d.category)));
}

function testingPending(run) {
  return sortQuestions(getPendingDecisions(run).filter((d) => TEST_CAPABILITY_CATEGORIES.has(d.category)));
}

function discoveryIncomplete(run) {
  const types = blockerTypes(run);
  return types.has('jira') || types.has('figma');
}

function verificationIsReady(run) {
  return (
    run.verification_result?.run_id === run.id &&
    run.verification_result?.status === DELIVERY_STATUS.READY_FOR_REVIEW
  );
}

function regressionManualPending(session) {
  return (
    session.regression.presented &&
    (session.regression.manual || []).length > 0 &&
    !session.regression.confirmed
  );
}

export function regressionEvidencePending(session) {
  const cases = session.regression?.cases || [];
  if (!cases.length) return false;
  if (regressionManualPending(session)) return true;
  const results = session.regression.case_results || [];
  if (!results.length) return true;
  return results.some((result) => result.status !== 'Passed');
}

function manualQaPending(session) {
  const manual = session.testing?.manual_qa || {};
  const manualCases =
    (manual.cases || []).length > 0
      ? manual.cases
      : session.testing?.test_cases?.manual || [];
  return Boolean(
    manual.required &&
    manualCases.length &&
    !manual.confirmed &&
    session.implementation?.summary
  );
}

export function e2eCapabilitySnapshot(resolved = {}) {
  const risk = resolved.strategy?.risk || {};
  const cap = resolved.testCapabilities?.e2e || {};
  const appropriate = Boolean(risk.e2e);
  const available = isAutomationAvailable(cap);
  return {
    appropriate,
    available,
    proposed: appropriate && available,
    status: cap.status || 'unavailable',
    framework: cap.framework || null,
    executed: false,
  };
}

function scenarioText(item) {
  if (item == null) return '';
  if (typeof item === 'string') return item;
  return item.description || item.scenarioId || item.id || String(item);
}

function toStructuredCase(item, type, fallbackId) {
  if (item && typeof item === 'object' && item.id && item.steps) {
    return { type, ...item };
  }
  const text = scenarioText(item);
  const idMatch = text.match(/\b(AC\d+-[TEM]\d+|AC-[A-Z0-9-]+)\b/i);
  const id = idMatch ? idMatch[1].toUpperCase() : fallbackId;
  const description = text.replace(/^\s*(AC\d+-[TEM]\d+|AC-[A-Z0-9-]+):\s*/i, '').trim() || text;
  const preconditions =
    type === 'e2e'
      ? 'Application is running in the existing E2E environment; user is in the relevant starting state.'
      : type === 'manual'
        ? 'Feature is deployed or running locally; tester can access the target screen.'
        : 'Unit/component test harness is available; feature module is imported in isolation.';
  const steps =
    type === 'e2e'
      ? [`Open the affected flow.`, `Perform: ${description}`, 'Observe the resulting UI and data.']
      : type === 'manual'
        ? [`Navigate to the affected screen.`, `Perform: ${description}`, 'Record the visible result.']
        : [`Arrange the unit with the preconditions for "${description}".`, 'Exercise the behavior under test.', 'Assert the outcome.'];
  const expected =
    type === 'manual' || type === 'e2e'
      ? `The flow completes as specified: ${description}`
      : `The unit satisfies: ${description}`;
  return { id, type, description, preconditions, steps, expected };
}

export function collectTestCases(run, resolved, intake = {}) {
  const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
  const contractText = fs.existsSync(contractPath) ? fs.readFileSync(contractPath, 'utf8') : '';
  const strategy = resolved?.strategy || {
    unit: { required: false },
    e2e: { required: false },
    manual: { required: true },
  };
  // The case LIST is always produced so the user can copy-paste it, even when the
  // repository has no usable test runner. Automation availability (`strategy.*.required`)
  // governs only whether real test FILES must exist and be executed — never whether the
  // cases are written down.
  const listingStrategy = {
    ...strategy,
    unit: { ...(strategy.unit || {}), required: true },
    e2e: { ...(strategy.e2e || {}), required: true },
    manual: { ...(strategy.manual || {}), required: true },
  };
  const unit = generateUnitScenarios({ contractText, strategy: listingStrategy }).map((s, i) =>
    toStructuredCase(s, 'unit', `AC1-T${String(i + 1).padStart(2, '0')}`)
  );
  const e2e = generateE2eScenarios({ contractText, strategy: listingStrategy, intake }).map((s, i) =>
    toStructuredCase(s, 'e2e', `AC1-E${String(i + 1).padStart(2, '0')}`)
  );
  const manual = generateManualScenarios({ contractText, strategy: listingStrategy }).map((s, i) =>
    toStructuredCase(s, 'manual', `AC1-M${String(i + 1).padStart(2, '0')}`)
  );
  const extra = [];
  {
    extra.push(
      toStructuredCase(
        'AC-permissions: Deny unauthorized access where the feature touches permissions.',
        'unit',
        'AC-PERMISSIONS'
      )
    );
    extra.push(
      toStructuredCase(
        'AC-loading-empty: Loading and empty states render without errors.',
        'unit',
        'AC-LOADING-EMPTY'
      )
    );
    extra.push(
      toStructuredCase('AC-error: Error/failure states surface a recoverable message.', 'unit', 'AC-ERROR')
    );
  }
  return { unit, e2e, manual, extra };
}

export function formatTestCasesCopy(cases = {}) {
  const lines = ['## Test cases (copy-pasteable)', ''];
  const section = (title, items) => {
    lines.push(`### ${title}`, '');
    if (!items?.length) {
      lines.push('_None for this strategy._', '');
      return;
    }
    for (const raw of items) {
      const inferredType = raw?.type
        || (title.toLowerCase().includes('e2e') ? 'e2e' : title.toLowerCase().includes('manual') ? 'manual' : 'unit');
      const item = toStructuredCase(raw, inferredType);
      lines.push(`#### ${item.id}`);
      lines.push(`- **ID:** ${item.id}`);
      lines.push(`- **Type:** ${item.type}`);
      lines.push(`- **Preconditions:** ${item.preconditions}`);
      lines.push('- **Steps:**');
      (item.steps || []).forEach((step, index) => lines.push(`  ${index + 1}. ${step}`));
      lines.push(`- **Expected result:** ${item.expected}`);
      lines.push('');
    }
  };
  section('Unit', cases.unit);
  section('E2E', cases.e2e);
  section('Manual QA', cases.manual);
  section('Additional coverage (permissions, loading/empty, errors)', cases.extra);
  return lines.join('\n').trim();
}

/** Cases beyond this count are summarised in chat; the full list goes to the artifact file. */
export const TEST_CASE_INLINE_LIMIT = 15;

export function countTestCases(cases = {}) {
  const groups = ['unit', 'e2e', 'manual', 'extra'];
  const counts = {};
  let total = 0;
  for (const group of groups) {
    const n = (cases[group] || []).length;
    counts[group] = n;
    total += n;
  }
  return { ...counts, total };
}

function acIdOf(item) {
  return String(item?.id || item?.scenarioId || '').match(/^(AC\d+|AC-[A-Z0-9-]+)/i)?.[1]?.toUpperCase() || 'Other';
}

/**
 * Compact view for large case sets: a reviewer cannot meaningfully approve 40+ cases
 * pasted into a chat window, so show the shape of the suite plus one example per
 * acceptance criterion, and point at the file holding the full copy-pasteable list.
 */
export function formatTestCasesSummary(cases = {}, { artifactPath: filePath = null } = {}) {
  const counts = countTestCases(cases);
  const all = [
    ...(cases.unit || []),
    ...(cases.e2e || []),
    ...(cases.manual || []),
    ...(cases.extra || []),
  ];
  const byAc = new Map();
  for (const item of all) {
    const ac = acIdOf(item);
    if (!byAc.has(ac)) byAc.set(ac, []);
    byAc.get(ac).push(item);
  }
  const lines = [
    `## Test cases — ${counts.total} proposed (summary)`,
    '',
    `This suite is too large to review line-by-line in chat, so here is its shape. The full copy-pasteable list is in:`,
    '',
    `\`${filePath || 'the run\'s test-cases.md artifact'}\``,
    '',
    '| Type | Count |',
    '|------|-------|',
    `| Unit | ${counts.unit} |`,
    `| E2E | ${counts.e2e} |`,
    `| Manual QA | ${counts.manual} |`,
    `| Additional coverage | ${counts.extra} |`,
    `| **Total** | **${counts.total}** |`,
    '',
    '### Per acceptance criterion',
  ];
  for (const [ac, items] of byAc) {
    const kinds = items.reduce((acc, i) => {
      acc[i.type || 'unit'] = (acc[i.type || 'unit'] || 0) + 1;
      return acc;
    }, {});
    const breakdown = Object.entries(kinds).map(([k, v]) => `${v} ${k}`).join(', ');
    lines.push(`- **${ac}** — ${items.length} case(s) (${breakdown})`);
  }
  lines.push('', '### One example per acceptance criterion');
  for (const [ac, items] of byAc) {
    const item = items[0];
    lines.push(`- **${item.id}** (${item.type}) — ${item.description}`);
  }
  lines.push(
    '',
    `Confirm to accept all ${counts.total} cases, or open the file above to review them in full and tell me what to change.`
  );
  return lines.join('\n');
}

export function evaluateFeatureStage(run, resolved = null) {
  const session = initFeatureSession(run);
  if (resolved) {
    session.testing.e2e = {
      ...session.testing.e2e,
      ...e2eCapabilitySnapshot(resolved),
      executed: Boolean(session.testing.e2e.executed),
      user_decision: session.testing.e2e.user_decision,
    };
    session.testing.strategy = resolved.strategy;
    session.testing.manual_qa.required = Boolean(resolved.strategy?.manual?.required);
    session.testing.manual_qa.cases = session.testing.test_cases?.manual || [];
  }

  if (run.status === 'completed' || run.current_phase === 'completed') {
    session.stage = FEATURE_STAGES.COMPLETE;
    session.awaiting = AWAITING.NONE;
    session.awaiting_kind = null;
    return session;
  }

  if (run.current_phase === 'deliver') {
    session.stage = FEATURE_STAGES.DELIVER;
    session.awaiting = AWAITING.USER;
    session.awaiting_kind = 'delivery';
    return session;
  }

  if (run.current_phase === 'review') {
    session.stage = FEATURE_STAGES.REVIEW;
    session.awaiting = AWAITING.USER;
    session.awaiting_kind = 'delivery';
    return session;
  }

  if (run.current_phase === 'verify') {
    session.stage = FEATURE_STAGES.VERIFY;
    if (verificationIsReady(run)) {
      session.awaiting = AWAITING.USER;
      session.awaiting_kind = 'review';
    } else {
      session.awaiting = AWAITING.AGENT;
      session.awaiting_kind = 'verification';
    }
    return session;
  }

  if (run.current_phase === 'implement' && run.implementation_entered_at) {
    session.implementation.authorized = true;
    if (manualQaPending(session)) {
      session.stage = FEATURE_STAGES.MANUAL_QA;
      session.awaiting = AWAITING.USER;
      session.awaiting_kind = 'manual_qa';
      return session;
    }
    if (regressionEvidencePending(session) || regressionManualPending(session)) {
      session.stage = FEATURE_STAGES.REGRESSION;
      session.awaiting = AWAITING.USER;
      session.awaiting_kind = 'regression';
      return session;
    }
    session.stage = FEATURE_STAGES.IMPLEMENT;
    session.awaiting = AWAITING.AGENT;
    session.awaiting_kind = 'implementation';
    return session;
  }

  if (discoveryIncomplete(run)) {
    session.stage = FEATURE_STAGES.INTAKE;
    session.awaiting = AWAITING.AGENT;
    session.awaiting_kind = 'discovery';
    return session;
  }

  const clarifications = clarificationPending(run);
  if (clarifications.length) {
    session.stage = FEATURE_STAGES.CLARIFICATION;
    session.awaiting = AWAITING.USER;
    session.awaiting_kind = 'questions';
    return session;
  }

  const testingQs = testingPending(run);
  if (testingQs.length || !session.testing.confirmed) {
    session.stage = FEATURE_STAGES.TESTING_STRATEGY;
    session.awaiting = AWAITING.USER;
    session.awaiting_kind = testingQs.length ? 'questions' : 'testing_strategy';
    return session;
  }

  if (!session.testing.test_cases_confirmed) {
    session.stage = FEATURE_STAGES.TEST_CASES;
    session.awaiting = AWAITING.USER;
    session.awaiting_kind = 'test_cases';
    if (resolved) session.testing.test_cases = collectTestCases(run, resolved, {});
    return session;
  }

  session.stage = FEATURE_STAGES.TEST_CASES;
  session.awaiting = AWAITING.USER;
  session.awaiting_kind = 'test_cases';
  return session;
}

function agentDiscoveryInstructions(run) {
  const blockers = run.orchestration?.blockers || [];
  const lines = [];
  for (const b of blockers) {
    if (b.type === 'jira') {
      lines.push(
        'Jira discovery is incomplete. Fetch the issue via REST or MCP in this chat, write normalized JSON, then ingest it with `eos intel jira --from-json <path>` and continue. Do not ask the user to run CLI commands.'
      );
    }
    if (b.type === 'figma') {
      lines.push(
        'Figma discovery is incomplete. Extract screens/interactions via MCP in this chat, write normalized JSON, then ingest it with `eos intel figma --from-json <path>` and continue. Do not ask the user to run CLI commands.'
      );
    }
  }
  return lines;
}

function renderQuestions(questions) {
  if (!questions.length) return '';
  const blocks = questions.map((d, index) => {
    const impact = d.impact ? `\n   Impact: ${d.impact}` : '';
    if (d.answerType === 'free_text' || !d.options?.length) {
      return `${index + 1}. **${d.question}**${impact}\n   Reply in this chat with the missing information.`;
    }
    const options = d.options.map((o, i) => `   ${i + 1}. ${o.label}`).join('\n');
    return `${index + 1}. **${d.question}**${impact}\n${options}`;
  });
  return `Unresolved questions require your answer in this chat. No reply is not a decision.\n\n${blocks.join('\n\n')}`;
}

export function buildFeatureTurn(root, state, resolved = null) {
  const run = state.active_run;
  if (!run) {
    const completion = state.last_completion || null;
    if (completion) {
      return {
        run_id: completion.run_id,
        stage: FEATURE_STAGES.COMPLETE,
        awaiting: AWAITING.NONE,
        awaiting_kind: null,
        implementation_permitted: false,
        questions: [],
        completion,
        message: renderCompletionReport(completion),
        agent_instructions: [
          'The feature is delivered. Present this completion report to the user. Do not say there is no active feature run.',
        ],
      };
    }
    return {
      run_id: null,
      stage: null,
      awaiting: AWAITING.NONE,
      implementation_permitted: false,
      questions: [],
      message: 'No active feature run.',
    };
  }
  const session = evaluateFeatureStage(run, resolved);
  if (session.stage === FEATURE_STAGES.TEST_CASES && resolved) {
    session.testing.test_cases = collectTestCases(run, resolved, state.feature_intake || {});
  }
  const pending = getPendingDecisions(run);
  const allQuestions =
    session.awaiting_kind === 'questions'
      ? session.stage === FEATURE_STAGES.TESTING_STRATEGY
        ? testingPending(run)
        : clarificationPending(run)
      : [];
  const questions = allQuestions.slice(0, 1);

  const permitted = isImplementationPermitted(run);
  const e2e = session.testing.e2e;
  const testCases = session.testing.test_cases || {};

  let message = '';
  const agent_instructions = [];

  if (session.awaiting === AWAITING.AGENT && session.awaiting_kind === 'discovery') {
    message = ['## Intake blocked on discovery', '', ...agentDiscoveryInstructions(run)].join('\n');
    agent_instructions.push(...agentDiscoveryInstructions(run));
    agent_instructions.push('After ingest succeeds, the same run continues automatically. Present any resulting questions in this chat.');
  } else if (session.stage === FEATURE_STAGES.CLARIFICATION) {
    message = `## Clarification needed\n\n${renderQuestions(questions)}`;
    agent_instructions.push(
      'Present this single question in this chat. Wait for the user. Do not auto-answer. Then run `eos feature continue --answer "<user reply>"`. After the answer, the engine re-discovers; ask the next newly unresolved question only.'
    );
  } else if (session.stage === FEATURE_STAGES.TESTING_STRATEGY && questions.length) {
    message = [
      '## Testing strategy — decision required',
      '',
      renderTestingStrategyBody(session, e2e),
      '',
      renderQuestions(questions),
    ].join('\n');
    agent_instructions.push(
      'Present the testing decision in this chat. Wait for an explicit user choice. Never install or configure an E2E framework automatically.'
    );
  } else if (session.stage === FEATURE_STAGES.TESTING_STRATEGY) {
    message = [
      '## Testing strategy',
      '',
      renderTestingStrategyBody(session, e2e),
      '',
      'Reply **confirm** in this chat to accept this testing strategy before implementation. Reply **no** to request a change.',
    ].join('\n');
    agent_instructions.push(
      'Wait for explicit confirmation of the testing strategy. Do not treat silence as approval. Then run `eos feature continue --confirm testing-strategy` or `--answer confirm`.'
    );
  } else if (session.stage === FEATURE_STAGES.TEST_CASES && run.current_phase !== 'implement') {
    // Always write the full list to the run artifact before asking for approval, so the
    // cases are readable even if they are summarised here or the agent fails to paste them.
    const casesPath = persistConfirmedTestCases(run, session, { confirmed: false });
    const relativeCasesPath = casesPath ? path.relative(root, casesPath) : null;
    const counts = countTestCases(testCases);
    const oversized = counts.total > TEST_CASE_INLINE_LIMIT;
    message = [
      oversized
        ? formatTestCasesSummary(testCases, { artifactPath: relativeCasesPath })
        : formatTestCasesCopy(testCases),
      '',
      oversized
        ? `Full list (${counts.total} cases): \`${relativeCasesPath}\``
        : `Full list also saved to: \`${relativeCasesPath}\``,
      '',
      'Reply **confirm** in this chat to accept these test cases and authorize implementation. No application code will be changed until you confirm.',
    ].join('\n');
    agent_instructions.push(
      oversized
        ? `This suite has ${counts.total} cases — too many to paste. Present the summary above verbatim and point the user at the saved file. Wait for explicit confirmation, then run \`eos feature continue --confirm test-cases\`.`
        : 'Present the test cases in a copy-pasteable format. Wait for explicit confirmation. Then run `eos feature continue --confirm test-cases`.'
    );
  } else if (session.stage === FEATURE_STAGES.IMPLEMENT) {
    const enforcement = detectConsumerEnforcement(root);
    const enforcementNote = enforcement.hard_hook_complete
      ? 'Cursor fail-closed mutation hooks are active for this repository.'
      : 'Hard mutation interception is unsupported for Claude Code, Copilot, and Generic adapters, and for Cursor until fail-closed hooks are installed. Engine CLI/workflow gates still apply; do not claim universal hard enforcement.';
    message = [
      '## Implementation authorized',
      '',
      'All required questions, testing strategy, and test cases are confirmed. Implement the feature, create automated tests with the implementation, and run available automated tests.',
      '',
      enforcementNote,
      '',
      'Reporting implementation in chat does not complete verification, review, or delivery.',
      ...(session.implementation.blocked_reasons || []).length
        ? ['', '### Blocked', ...(session.implementation.blocked_reasons || []).map((r) => `- ${r}`)]
        : [],
    ].join('\n');
    agent_instructions.push(
      'Implement only now. Create automated tests. After tests exist on disk and have been executed, submit evidence with `eos feature continue --implemented --summary "..." --tests-created "path/to/test"`. Do not claim a test passed unless it was executed. Do not treat this as workflow completion.'
    );
  } else if (session.stage === FEATURE_STAGES.MANUAL_QA) {
    message = renderManualQaMessage(session);
    agent_instructions.push(
      'Present the functional Manual QA cases in this chat. Wait for the user to confirm execution, then run `eos feature continue --confirm manual-qa`. Record only user-confirmed manual evidence.'
    );
  } else if (session.stage === FEATURE_STAGES.REGRESSION) {
    message = renderRegressionMessage(session);
    agent_instructions.push(
      'Present the regression cases. If manual regression is listed, wait for the user to confirm they performed it. Then `eos feature continue --confirm regression`.'
    );
  } else if (session.stage === FEATURE_STAGES.VERIFY) {
    message = renderVerificationMessage(run, session);
    if (session.awaiting_kind === 'review') {
      agent_instructions.push(
        'Verification is READY FOR REVIEW. Present the verification summary and wait for explicit review confirmation. Then `eos feature continue --confirm review`.'
      );
    } else {
      agent_instructions.push(
        'Verification is incomplete. Fill verification-evidence from actual implementation files and executed tests for this run. Re-run `eos feature continue` (no completion flag) to refresh verification. Do not skip to review or delivery.'
      );
    }
  } else if (session.stage === FEATURE_STAGES.REVIEW || session.stage === FEATURE_STAGES.DELIVER) {
    message = renderReviewDeliveryMessage(run, session);
    agent_instructions.push(
      session.stage === FEATURE_STAGES.REVIEW
        ? 'Present the review summary. Wait for explicit delivery confirmation. Then `eos feature continue --confirm delivery`.'
        : 'Present delivery preparation. Wait for explicit delivery sign-off in this chat. Then `eos feature continue --confirm delivery`.'
    );
  } else if (session.stage === FEATURE_STAGES.COMPLETE) {
    const completion = session.completion || state.last_completion;
    message = completion
      ? renderCompletionReport(completion)
      : '## Feature delivered\n\nThe run completed through verify → review → deliver.';
  }

  return {
    run_id: run.id,
    stage: session.stage,
    awaiting: session.awaiting,
    awaiting_kind: session.awaiting_kind,
    blocked: Boolean(run.blocked),
    current_phase: run.current_phase,
    implementation_permitted: Boolean(permitted.ok),
    implementation_reason: permitted.ok ? null : permitted.reason,
    questions,
    testing_strategy: session.testing.strategy,
    testing_confirmed: session.testing.confirmed,
    test_cases: testCases,
    test_cases_confirmed: session.testing.test_cases_confirmed,
    manual_qa: session.testing.manual_qa,
    e2e: {
      appropriate: Boolean(e2e.appropriate),
      available: Boolean(e2e.available),
      proposed: Boolean(e2e.proposed),
      user_decision: e2e.user_decision,
      executed: Boolean(e2e.executed),
      claimed_available: Boolean(e2e.available),
    },
    implementation: session.implementation,
    regression: session.regression,
    verification: run.verification_result || null,
    completion: session.completion,
    pending_decision_ids: pending.map((d) => d.id),
    remaining_question_count: allQuestions.length,
    agent_instructions,
    message,
  };
}

function renderTestingStrategyBody(session, e2e) {
  const strategy = session.testing.strategy || {};
  const unit = strategy.unit || {};
  const e2eS = strategy.e2e || {};
  const manual = strategy.manual || {};
  const lines = [
    `Proposed strategy: **${strategy.strategy_label || 'undecided'}**`,
    '',
    `- Unit tests: ${unit.required ? 'yes' : 'no'}${unit.reason ? ` — ${unit.reason}` : ''}`,
    `- E2E tests: ${e2e.appropriate ? (e2e.available ? 'yes (framework detected)' : 'appropriate but not configured') : 'not appropriate'}`,
    `- Manual QA: ${manual.required ? 'yes' : 'no'}${manual.reason ? ` — ${manual.reason}` : ''}`,
    '',
    `E2E availability: **${e2e.available ? e2e.framework || 'available' : 'not configured'}**. E2E will not be installed or claimed as executed unless it actually exists and runs.`,
  ];
  if (e2e.appropriate && e2e.available) {
    lines.push('', `Proposed E2E approach: use the existing **${e2e.framework || 'E2E'}** infrastructure for critical user journeys. No new E2E framework will be installed.`);
  }
  if (e2e.appropriate && !e2e.available) {
    lines.push('', 'E2E is appropriate for this feature but this repository has no E2E framework. Do not install one. Choose whether to proceed without E2E using available automated tests and Manual QA.');
  }
  if (e2eS.reason && !e2e.appropriate) {
    lines.push('', e2eS.reason);
  }
  return lines.join('\n');
}

function renderRegressionMessage(session) {
  const reg = session.regression || {};
  const caseResults = new Map((reg.case_results || []).map((result) => [result.regId, result]));
  const cases = (reg.cases || [])
    .map((s) => {
      const result = caseResults.get(s.regId);
      const status = result ? ` — ${result.status}` : '';
      return `- ${s.description || s.regId}${status}`;
    })
    .join('\n') || '- None generated.';
  const automated = (reg.cases || []).filter((s) => s.kind === 'automated' || s.automated);
  const manual = (reg.manual || []).map((s) => `- ${s.label || s}`).join('\n') || '- None.';
  const resultLines = (reg.case_results || [])
    .map((result) => `- ${result.regId}: ${result.status} (${result.testReference}) — ${result.evidence}`)
    .join('\n');
  const impactMap = renderRegressionImpactGraph({
    regressionImpact: reg.impact || {},
    scenarios: reg.cases || [],
  });
  return [
    '## Regression verification',
    '',
    impactMap,
    '',
    '### Regression test cases (copy-pasteable)',
    cases,
    '',
    '### Automated regression',
    automated.length ? automated.map((s) => `- ${s.description || s.regId}`).join('\n') : '- Covered by executed automated checks where applicable.',
    '',
    '### Manual regression',
    manual,
    '',
    '### Per-case results',
    resultLines || '- Not yet executed for this run.',
    '',
    'Required regression cases need current-run evidence. Implementation test results are not reused as regression evidence. Reply **confirm** after performing required manual regression, or after adding missing REG test files.',
  ].join('\n');
}

function renderManualQaMessage(session) {
  const manual = session.testing?.manual_qa || {};
  const cases = (manual.cases || [])
    .map((item) =>
      typeof item === 'string'
        ? `- ${item}`
        : `- ${item.id || item.scenarioId}: ${item.description || ''}`.trim()
    )
    .join('\n') || '- None generated.';
  return [
    '## Functional Manual QA',
    '',
    '### Manual QA test cases (copy-pasteable)',
    cases,
    '',
    'These checks require human execution. Reply **confirm** in this chat only after completing them; the workflow records user-confirmed Manual QA evidence and then continues to regression verification.',
  ].join('\n');
}

function renderVerificationMessage(run, session) {
  const result = run.verification_result;
  const reasons = result?.reasons?.length ? result.reasons.map((r) => `- ${r}`).join('\n') : '- None recorded.';
  const impl = session.implementation || {};
  const results = impl.automated_results || [];
  const resultLines = results.length
    ? results.map((r) => `- ${r.name}: ${r.status}${r.command ? ` (\`${r.command}\`)` : ''}${r.executed ? '' : ' (not executed)'}`).join('\n')
    : '- No automated tests were executed.';
  return [
    '## Verification',
    '',
    `Current phase: **verify**. Implementation reports do not complete this phase.`,
    '',
    `### Status`,
    result ? `**${result.status}** (run ${result.run_id})` : '_Verification report has not been produced for this run._',
    '',
    '### Reasons',
    reasons,
    '',
    '### Automated test results (executed)',
    resultLines,
    '',
    `### E2E execution`,
    session.testing.e2e.executed ? 'Executed' : 'Not executed',
    '',
    verificationIsReady(run)
      ? 'Reply **confirm** in this chat to complete review of this verification.'
      : 'Verification is incomplete. Delivery cannot become READY while required tests, regression, or evidence remain unresolved.',
  ].join('\n');
}

function renderReviewDeliveryMessage(run, session) {
  const result = run.verification_result;
  return [
    session.stage === FEATURE_STAGES.REVIEW ? '## Review' : '## Delivery',
    '',
    `Current phase: **${run.current_phase}**.`,
    '',
    `Verification: ${result?.status || 'not recorded'}`,
    '',
    session.stage === FEATURE_STAGES.REVIEW
      ? 'Review notes will be recorded from this confirmation. Reply **confirm** in this chat to approve delivery preparation.'
      : 'Reply **confirm** in this chat to sign off delivery. Temporary artifacts are cleaned only after successful delivery.',
    '',
    renderRegressionMessage(session),
  ].join('\n');
}

export function renderFeatureTurn(turn, { json = false } = {}) {
  if (json) return JSON.stringify(turn, null, 2);
  const parts = [turn.message || ''];
  parts.push('', '--- EOS_FEATURE_TURN ---', JSON.stringify(turn, null, 2), '--- END EOS_FEATURE_TURN ---');
  return parts.join('\n');
}

function listResultLines(results = []) {
  if (!results.length) return '- None recorded.';
  return results
    .map(
      (result) =>
        `- ${result.name || result.scenarioId || result.regId || 'check'}: ${result.status || result.result || 'unknown'}${
          result.command ? ` (\`${result.command}\`)` : ''
        }`
    )
    .join('\n');
}

export function renderCompletionReport(completion = {}) {
  const implementation = completion.implementation || {};
  const unit = completion.unit || {};
  const e2e = completion.e2e || {};
  const manual = completion.manual_qa || {};
  const regression = completion.regression || {};
  const verification = completion.verification || {};
  const review = completion.review || {};
  const delivery = completion.delivery || {};
  const cleanup = completion.cleanup || {};
  const files = (implementation.files_changed || []).map((file) => `- ${file}`).join('\n') || '- None recorded.';
  const formatCase = (item) =>
    `- ${typeof item === 'string' ? item : `${item.id || item.scenarioId || 'case'}: ${item.description || item.type || ''}`.trim()}`;
  const unitCases = (unit.cases || []).map(formatCase).join('\n') || '- None.';
  const e2eCases = (e2e.cases || []).map(formatCase).join('\n') || '- None.';
  const manualCases = (manual.cases || []).map(formatCase).join('\n') || '- None.';
  const regressionResults = (regression.case_results || [])
    .map((result) => `- ${result.regId}: ${result.status} (${result.testReference}) — ${result.evidence}`)
    .join('\n') || '- None.';
  const unresolved = (completion.unresolved || []).map((item) => `- ${item}`).join('\n') || '- None.';
  // Checks that did not actually run must be stated, never folded into a pass.
  const notExecutedLines = (completion.checks || [])
    .filter((c) => c.status && c.status !== 'Passed')
    .map(
      (c) =>
        `- **${c.name}**: ${c.status}${c.failureSummary ? ` — ${c.failureSummary}` : ''}${
          c.command ? ` (\`${c.command}\`)` : ''
        }`
    );
  // A check that was skipped never reaches completion.checks at all, so the strategy itself
  // is the only record that it was appropriate but not run. Omitting these would let the
  // report read as if full coverage was achieved.
  if (e2e.applicable && !e2e.executed) {
    const why = e2e.user_decision
      ? `user decided \`${e2e.user_decision}\``
      : e2e.available
        ? 'not run in this run'
        : 'no runnable E2E setup in this repository';
    notExecutedLines.push(
      `- **E2E**: Not executed — ${why}. The E2E cases above were not verified automatically.`
    );
  }
  if (manual.applicable && !manual.confirmed) {
    notExecutedLines.push('- **Manual QA**: Not confirmed — the manual cases above still need a human pass.');
  }
  if ((regression.cases || []).length && !(regression.case_results || []).length) {
    notExecutedLines.push(
      `- **Regression**: ${(regression.cases || []).length} case(s) generated with no recorded evidence.`
    );
  }
  const notExecuted = notExecutedLines.join('\n') || '- None — every applicable check ran.';
  const e2eStatus = e2e.applicable
    ? `${e2e.available ? 'available' : 'unavailable'}; ${e2e.executed ? 'executed' : 'not executed'}${
        e2e.user_decision ? `; decision: ${e2e.user_decision}` : ''
      }`
    : 'not applicable';
  // Full copy-pasteable case block, kept in this durable record so the confirmed test
  // cases survive cleanup of the temporary run artifacts.
  const copyPasteCases = formatTestCasesCopy({
    unit: unit.cases || [],
    e2e: e2e.cases || [],
    manual: manual.cases || [],
    extra: [],
  });
  const regressionCopy = (regression.cases || [])
    .map((item) => {
      if (typeof item === 'string') return `- ${item}`;
      const kind = [item.automated ? 'automated' : null, item.manual ? 'manual QA' : null]
        .filter(Boolean)
        .join(' + ') || 'manual QA';
      const expected = item.expectedBehavior ? ` Expected: ${item.expectedBehavior}` : '';
      return `- **${item.regId}** (${kind}) — ${item.description || item.flow || ''}.${expected}`;
    })
    .join('\n') || '- None.';
  return [
    '## Feature completion report',
    '',
    `Run **${completion.run_id || 'unknown'}** delivered. Temporary run artifacts were cleaned; this report is the durable delivery record.`,
    '',
    '### Implementation summary / files changed',
    implementation.summary || '_No summary recorded._',
    '',
    files,
    '',
    copyPasteCases,
    '',
    renderRegressionImpactGraph({
      regressionImpact: regression.impact || {},
      scenarios: regression.cases || [],
    }),
    '',
    '### Regression test cases (copy-pasteable)',
    regressionCopy,
    '',
    '### Unit test cases + execution result',
    unitCases,
    '',
    listResultLines(unit.results),
    '',
    '### E2E status / results',
    e2e.applicable ? e2eStatus : 'Not applicable for this strategy.',
    e2eCases,
    listResultLines(e2e.results),
    '',
    '### Manual QA status',
    manual.applicable
      ? `${manual.confirmed ? 'Confirmed' : 'Not confirmed'} (${(manual.case_results || []).length} case result(s))`
      : 'Not applicable.',
    manualCases,
    '',
    '### Regression per-case results',
    regressionResults,
    '',
    '### Verification status',
    verification.status || 'not recorded',
    '',
    '### Review / delivery status',
    `- Review: ${review.status || 'not recorded'}`,
    `- Delivery: ${delivery.status || 'not recorded'}`,
    '',
    '### Not executed (limitations)',
    notExecuted,
    '',
    '### Unresolved / remaining items',
    unresolved,
    '',
    '### Cleanup result',
    `- Status: ${cleanup.status || 'not recorded'}`,
    `- Removed: ${(cleanup.removed || []).length} path(s)`,
    `- Preserved: ${(cleanup.preserved || []).length} path(s)`,
    ...(cleanup.errors || []).map((error) => `- Error: ${error}`),
  ].join('\n');
}

export function buildCompletionSnapshot(root, run, cleanup = null) {
  const session = initFeatureSession(run);
  let filesChanged = session.implementation.tests_created || [];
  try {
    const changed = getImplementationChangedFiles(root, run);
    if (changed.files?.length) filesChanged = changed.files;
  } catch {
    /* keep reported test files */
  }
  const automated = session.implementation.automated_results || [];
  const unresolved = [
    ...(session.implementation.blocked_reasons || []),
    ...((run.orchestration?.blockers || []).map((blocker) => blocker.reason)),
    ...((session.regression.case_results || [])
      .filter((result) => result.status !== 'Passed')
      .map((result) => `Regression ${result.regId}: ${result.status}`)),
  ].filter(Boolean);
  return {
    run_id: run.id,
    completed_at: nowIso(),
    implementation: {
      summary: session.implementation.summary || '',
      files_changed: filesChanged,
      tests_created: session.implementation.tests_created || [],
    },
    unit: {
      cases: session.testing.test_cases?.unit || [],
      results: automated.filter((result) => /unit tests/i.test(result.name || '')),
    },
    e2e: {
      applicable: Boolean(session.testing.e2e.appropriate || session.testing.strategy?.e2e?.required),
      available: Boolean(session.testing.e2e.available),
      executed: Boolean(session.testing.e2e.executed),
      user_decision: session.testing.e2e.user_decision || null,
      cases: session.testing.test_cases?.e2e || [],
      results: automated.filter((result) => /e2e|playwright|cypress/i.test(`${result.name || ''} ${result.command || ''}`)),
    },
    manual_qa: {
      applicable: Boolean(session.testing.manual_qa?.required),
      confirmed: Boolean(session.testing.manual_qa?.confirmed),
      cases: session.testing.manual_qa?.cases || session.testing.test_cases?.manual || [],
      case_results: session.testing.manual_qa?.case_results || [],
    },
    regression: {
      cases: session.regression.cases || [],
      case_results: session.regression.case_results || [],
      impact: session.regression.impact || null,
    },
    checks: automated,
    verification: run.verification_result || null,
    review: {
      status: (run.completed_phases || []).includes('review') ? 'confirmed' : 'not confirmed',
    },
    delivery: {
      status: (run.completed_phases || []).includes('deliver') ? 'signed-off' : 'not signed-off',
      signoff: run.gates?.['delivery-signoff']?.status || null,
    },
    unresolved: [...new Set(unresolved)],
    cleanup: summarizeCleanup(cleanup),
  };
}

export function summarizeCleanup(cleanup = null) {
  if (!cleanup) return { status: 'pending', removed: [], preserved: [], errors: [] };
  return {
    status: cleanup.errors?.length ? 'failed' : 'completed',
    removed: (cleanup.removed || []).map((item) => item.path || item),
    preserved: (cleanup.toPreserve || []).map((item) => item.path || item),
    errors: cleanup.errors || [],
  };
}

function appendCompletionToDelivery(run, snapshot) {
  const deliveryPath = artifactPath(run.artifacts_dir, 'delivery-preparation');
  if (!fs.existsSync(deliveryPath)) return;
  let content = fs.readFileSync(deliveryPath, 'utf8');
  const report = renderCompletionReport(snapshot);
  if (content.includes('## Feature completion report')) {
    content = content.replace(/## Feature completion report[\s\S]*$/, report.trimEnd());
  } else {
    content = `${content.trimEnd()}\n\n${report}\n`;
  }
  fs.writeFileSync(deliveryPath, content);
}

/**
 * Write the full copy-pasteable case list to the run's test-cases artifact.
 *
 * This runs as soon as the cases are generated, not only on confirmation: the user is
 * asked to approve them, so the list must exist somewhere readable before the decision,
 * even if the agent fails to paste it into the chat.
 */
export function persistConfirmedTestCases(run, session = initFeatureSession(run), { confirmed = true } = {}) {
  if (!run?.artifacts_dir) return null;
  const dest = artifactPath(run.artifacts_dir, 'test-cases');
  const body = formatTestCasesCopy(session.testing.test_cases || {});
  const heading = confirmed ? '# Confirmed test cases' : '# Proposed test cases (awaiting confirmation)';
  const status = confirmed ? 'approved' : 'draft';
  const stamp = confirmed
    ? `- **Confirmed at:** ${session.testing.test_cases_confirmed_at || nowIso()}`
    : `- **Generated at:** ${nowIso()}`;
  const content = `${heading}\n\n<!-- EOS_ARTIFACT_STATUS: ${status} -->\n\n- **Run ID:** ${run.id}\n${stamp}\n\n${body}\n`;
  fs.writeFileSync(dest, content);
  return dest;
}

function persistCompletion(root, state, snapshot) {
  state.last_completion = snapshot;
  const run = state.active_run;
  if (run) {
    initFeatureSession(run).completion = snapshot;
  }
  const archived = (state.completed_runs || []).find((item) => item.id === snapshot.run_id);
  if (archived) archived.completion = snapshot;
  saveState(root, state);
}

export function applyContinueInput(run, input = {}, helpers = {}) {
  const session = initFeatureSession(run);
  const { recordTestCapabilityDecision = () => {} } = helpers;
  const answer = input.answer != null ? String(input.answer) : '';
  const confirm = input.confirm || null;
  const decisionId = input.decisionId || input.question || null;
  const optionId = input.optionId || input.option || null;

  if (input.force) {
    return { ok: false, error: '--force cannot bypass /feature gates.' };
  }

  if (input.implemented) {
    if (hasPendingWorkflowDecisions(run) || clarificationPending(run).length) {
      return { ok: false, error: 'Cannot submit implementation evidence while required questions are unanswered.' };
    }
    if (run.current_phase !== 'implement' || !run.implementation_entered_at) {
      return { ok: false, error: 'Implementation evidence is accepted only after the authoritative implement transition.' };
    }
    return { ok: true, action: 'implemented' };
  }

  if (confirm === 'testing-strategy' || (session.awaiting_kind === 'testing_strategy' && isAffirmative(answer))) {
    if (testingPending(run).length || clarificationPending(run).length) {
      return { ok: false, error: 'Cannot confirm testing strategy while required questions are unanswered.' };
    }
    if (run.flags?.e2e_wait_requested || run.flags?.unit_wait_requested) {
      return { ok: false, error: 'Cannot confirm testing strategy while waiting for requested test automation.' };
    }
    if (isNegative(answer)) {
      return { ok: false, error: 'Testing strategy was not confirmed.' };
    }
    session.testing.confirmed = true;
    session.testing.confirmed_at = nowIso();
    recordConversation(session, { role: 'user', kind: 'confirm_testing_strategy', text: answer || confirm });
    return { ok: true, action: 'confirm_testing_strategy' };
  }

  if (confirm === 'test-cases' || (session.awaiting_kind === 'test_cases' && isAffirmative(answer))) {
    if (!session.testing.confirmed || hasPendingWorkflowDecisions(run)) {
      return { ok: false, error: 'Cannot confirm test cases until testing strategy and required decisions are complete.' };
    }
    if (isNegative(answer)) {
      return { ok: false, error: 'Test cases were not confirmed.' };
    }
    if (!session.testing.strategy) {
      return { ok: false, error: 'Cannot confirm test cases until testing strategy is confirmed.' };
    }
    session.testing.test_cases = collectTestCases(run, { strategy: session.testing.strategy }, {});
    session.testing.test_cases_confirmed = true;
    session.testing.test_cases_confirmed_at = nowIso();
    session.testing.manual_qa.required = Boolean(session.testing.strategy?.manual?.required);
    session.testing.manual_qa.cases = session.testing.test_cases?.manual || [];
    session.testing.manual_qa.presented = session.testing.manual_qa.cases.length > 0;
    recordConversation(session, { role: 'user', kind: 'confirm_test_cases', text: answer || confirm });
    return { ok: true, action: 'confirm_test_cases' };
  }

  if (confirm === 'manual-qa' || (session.awaiting_kind === 'manual_qa' && isAffirmative(answer))) {
    if (run.current_phase !== 'implement') {
      return { ok: false, error: 'Manual QA is recorded during the implement phase, before verification.' };
    }
    if (isNegative(answer)) {
      return { ok: false, error: 'Manual QA was not confirmed.' };
    }
    session.testing.manual_qa.confirmed = true;
    session.testing.manual_qa.confirmed_at = nowIso();
    recordConversation(session, { role: 'user', kind: 'confirm_manual_qa', text: answer || confirm });
    return { ok: true, action: 'confirm_manual_qa' };
  }

  if (confirm === 'regression' || (session.awaiting_kind === 'regression' && isAffirmative(answer))) {
    if (run.current_phase !== 'implement') {
      return { ok: false, error: 'Regression confirmation is recorded during the implement phase, before verify.' };
    }
    if (isNegative(answer)) {
      return { ok: false, error: 'Manual regression was not confirmed.' };
    }
    session.regression.confirmed = true;
    session.regression.confirmed_at = nowIso();
    recordConversation(session, { role: 'user', kind: 'confirm_regression', text: answer || confirm });
    return { ok: true, action: 'confirm_regression' };
  }

  if (confirm === 'review' || (session.awaiting_kind === 'review' && isAffirmative(answer))) {
    if (run.current_phase !== 'verify') {
      return { ok: false, error: 'Review can only be confirmed during the verify phase.' };
    }
    if (isNegative(answer)) {
      return { ok: false, error: 'Review was not confirmed.' };
    }
    recordConversation(session, { role: 'user', kind: 'confirm_review', text: answer || confirm });
    return { ok: true, action: 'confirm_review' };
  }

  if (confirm === 'delivery' || (session.awaiting_kind === 'delivery' && isAffirmative(answer))) {
    if (run.current_phase !== 'review' && run.current_phase !== 'deliver') {
      return { ok: false, error: 'Delivery can only be confirmed after review has started.' };
    }
    if (isNegative(answer)) {
      return { ok: false, error: 'Delivery was not confirmed.' };
    }
    recordConversation(session, { role: 'user', kind: 'confirm_delivery', text: answer || confirm });
    return { ok: true, action: 'confirm_delivery' };
  }

  const pending = sortQuestions(getPendingDecisions(run));
  if (!pending.length && !decisionId) {
    if (run.current_phase === 'verify') {
      return { ok: true, action: 'refresh_verification' };
    }
    if (
      run.current_phase === 'implement' &&
      session.implementation.summary &&
      !manualQaPending(session) &&
      !regressionManualPending(session)
    ) {
      return { ok: true, action: 'confirm_regression' };
    }
    if (session.awaiting_kind === 'testing_strategy' || session.awaiting_kind === 'test_cases' || session.awaiting_kind === 'manual_qa' || session.awaiting_kind === 'review' || session.awaiting_kind === 'delivery' || session.awaiting_kind === 'regression') {
      return { ok: false, error: 'An explicit confirmation is required. Reply confirm or no.' };
    }
    return { ok: false, error: 'No pending question to answer.' };
  }

  const target = decisionId ? getWorkflowDecision(run, decisionId) : pending[0];
  if (!target || target.status !== DECISION_STATUS.PENDING) {
    return { ok: false, error: `Decision "${decisionId || '(current)'}" is not pending.` };
  }

  if (target.answerType === 'free_text' || !target.options?.length) {
    const text = answer || optionId;
    if (!text || !String(text).trim()) {
      return { ok: false, error: 'A free-text answer is required.' };
    }
    answerWorkflowDecision(run, target.id, 'free_text', {
      source: input.source || 'user',
      note: text,
      freeText: text,
    });
    applyWorkflowDecisionEffects(run, target.id, 'free_text', { recordTestCapabilityDecision });
    applyAnsweredDecisionArtifacts(run);
    appendDecisionLogEntry(run, getWorkflowDecision(run, target.id));
    applyFreeTextToContract(run, getWorkflowDecision(run, target.id));
    recordConversation(session, { role: 'user', kind: 'answer', decisionId: target.id, text });
    return { ok: true, action: 'answer', decisionId: target.id };
  }

  const selected = optionId || matchAnswerToOption(target, answer);
  if (!selected) {
    return {
      ok: false,
      error: `Could not map the reply to an option for "${target.id}". Reply with an option label or number.`,
    };
  }
  answerWorkflowDecision(run, target.id, selected, { source: input.source || 'user', note: answer || '' });
  applyWorkflowDecisionEffects(run, target.id, selected, { recordTestCapabilityDecision });
  applyAnsweredDecisionArtifacts(run);
  appendDecisionLogEntry(run, getWorkflowDecision(run, target.id));
  if (target.id === 'e2e-automation' || target.id === 'unit-automation') {
    session.testing.e2e.user_decision = selected;
  }
  recordConversation(session, { role: 'user', kind: 'answer', decisionId: target.id, optionId: selected, text: answer });
  return { ok: true, action: 'answer', decisionId: target.id, optionId: selected };
}

function applyFreeTextToContract(run, decision) {
  if (!decision?.freeTextAnswer || !run?.artifacts_dir) return;
  const contractPath = artifactPath(run.artifacts_dir, 'feature-contract');
  if (!fs.existsSync(contractPath)) return;
  let content = fs.readFileSync(contractPath, 'utf8');
  const kind = decision.context?.kind || decision.id;
  const criteria = splitAnswerIntoCriteria(decision.freeTextAnswer);
  if (kind === 'acceptance-criteria' || decision.id.startsWith('clarification:acceptance-criteria')) {
    if (!isContractSufficient(content) || decision.id.endsWith(':followup')) {
      content = writeAcceptanceCriteria(content, criteria);
    }
  } else if (decision.context?.acId && criteria[0]) {
    content = replaceAcceptanceCriterion(content, decision.context.acId, criteria.join('; '));
  }
  const marker = `### Clarification: ${decision.id}`;
  if (!content.includes(marker)) {
    content += `\n\n${marker}\n\n- **Question:** ${decision.question}\n- **Resolved answer:** ${decision.freeTextAnswer}\n`;
  }
  fs.writeFileSync(contractPath, content);
}

export function reapplyAnsweredClarificationsToContract(run) {
  for (const decision of Object.values(run.workflow_decisions || {})) {
    if (
      decision?.status === DECISION_STATUS.ANSWERED &&
      String(decision.id || '').startsWith('clarification:') &&
      decision.freeTextAnswer
    ) {
      applyFreeTextToContract(run, decision);
    }
  }
}

export function canAuthorizeImplementation(run) {
  const session = initFeatureSession(run);
  if (hasPendingWorkflowDecisions(run)) {
    return { ok: false, reason: 'Unresolved workflow decisions require explicit user input.' };
  }
  if (!session.testing.confirmed) {
    return { ok: false, reason: 'Testing strategy is not explicitly confirmed.' };
  }
  if (!session.testing.test_cases_confirmed) {
    return { ok: false, reason: 'Test cases are not explicitly confirmed.' };
  }
  if (run.flags?.e2e_wait_requested || run.flags?.unit_wait_requested) {
    return { ok: false, reason: 'User chose not to implement until requested test automation is available.' };
  }
  if (discoveryIncomplete(run) || run.blocked) {
    return { ok: false, reason: 'Run is blocked on discovery or orchestration.' };
  }
  return { ok: true };
}

function ensureGateApproved(run, gateId, note) {
  run.gates = run.gates || {};
  run.gates[gateId] = {
    status: 'approved',
    updated_at: nowIso(),
    note,
    run_id: run.id,
  };
}

export function preserveCompletionAndCleanup(root, state, run) {
  const snapshot = buildCompletionSnapshot(root, run, null);
  initFeatureSession(run).completion = snapshot;
  appendCompletionToDelivery(run, snapshot);
  saveState(root, state);

  let cleanup = null;
  try {
    cleanup = executeCleanup(root, { runId: run.id, automatic: true });
  } catch (err) {
    run.cleanup = {
      status: 'failed',
      failed_at: nowIso(),
      errors: [err.message],
    };
    snapshot.cleanup = summarizeCleanup({ errors: [err.message], removed: [], toPreserve: [] });
    persistCompletion(root, state, snapshot);
    return { cleanupError: err.message, completion: snapshot, cleanup: null };
  }

  const latest = loadState(root) || state;
  const completion = {
    ...snapshot,
    cleanup: summarizeCleanup(cleanup),
  };
  latest.last_completion = completion;
  const archived = (latest.completed_runs || []).find((item) => item.id === run.id);
  if (archived) archived.completion = completion;
  saveState(root, latest);
  state.active_run = latest.active_run;
  state.completed_runs = latest.completed_runs;
  state.last_completion = latest.last_completion;
  state.feature_intake = latest.feature_intake;
  return { cleanup, completion };
}

export function runAuthoritativeCompletePhase(root, home, state) {
  const result = completePhase({
    frameworkRoot: home,
    eosRoot: eosDir(root),
    state,
    force: false,
  });
  if (!result.ok) return result;
  saveState(root, state);
  if (!result.completed) return result;
  return { ...result, ...preserveCompletionAndCleanup(root, state, result.run) };
}

export function authorizeImplementationFromConversation(root, home, state) {
  const run = state.active_run;
  const check = canAuthorizeImplementation(run);
  if (!check.ok) return check;

  ensureGateApproved(run, 'contract-approval', 'Conversational test-case confirmation');
  ensureGateApproved(run, 'plan-approval', 'Conversational test-case confirmation');
  if (run.flags?.architectural_impact) {
    ensureGateApproved(run, 'architecture-approval', 'Conversational architecture decision');
  }

  const workflow = loadWorkflow(home, run.workflow_id);
  if (run.current_phase !== 'approve' && run.current_phase !== 'implement') {
    advanceRunToPhase(run, workflow, 'approve');
  }

  if (run.current_phase === 'implement' && run.implementation_entered_at) {
    initFeatureSession(run).implementation.authorized = true;
    return { ok: true, already: true };
  }

  const entry = canEnterImplementPhase(run);
  if (!entry.ok) return entry;

  const result = runAuthoritativeCompletePhase(root, home, state);
  if (!result.ok) return result;
  initFeatureSession(run).implementation.authorized = true;
  return { ok: true, phase: run.current_phase };
}

export function looksLikeTestFile(filePath = '') {
  const normalized = String(filePath).replace(/\\/g, '/');
  return (
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(normalized) ||
    /(^|\/)(__tests__|tests|test|e2e|spec)s?\//i.test(normalized)
  );
}

export function looksLikeE2eTestFile(filePath = '', content = '') {
  const normalized = String(filePath).replace(/\\/g, '/');
  return (
    /(^|\/)(e2e|playwright|cypress)(\/|$)/i.test(normalized) ||
    /@playwright\/test|\bplaywright\b|\bcypress\b/i.test(String(content))
  );
}

function scenarioIds(items = [], prefix) {
  const pattern = new RegExp(`\\b(AC\\d+-${prefix}\\d+)\\b`, 'ig');
  const ids = new Set();
  for (const item of items) {
    const text = [item?.id, item?.scenarioId, scenarioText(item)].filter(Boolean).join(' ');
    for (const match of String(text).matchAll(pattern)) ids.add(match[1].toUpperCase());
  }
  return [...ids];
}

function testFilesForScenarioIds(root, files = [], ids = []) {
  const matches = new Map();
  for (const rel of files) {
    const abs = path.resolve(root, rel);
    if (!fs.existsSync(abs)) continue;
    const content = fs.readFileSync(abs, 'utf8');
    for (const id of ids) {
      if (new RegExp(`\\b${id}\\b`, 'i').test(content)) matches.set(id, rel);
    }
  }
  return matches;
}

function normalizeClaimedTestPaths(claimed) {
  if (Array.isArray(claimed)) return claimed.map((s) => String(s).trim()).filter(Boolean);
  return String(claimed || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function validateImplementationTestFiles(root, run, claimed = []) {
  const session = initFeatureSession(run);
  const strategy = session.testing.strategy || {};
  const unitRequired = Boolean(strategy.unit?.required);
  const e2eRequiredAndAvailable =
    Boolean(strategy.e2e?.required) && Boolean(session.testing.e2e.available);
  const claimedPaths = normalizeClaimedTestPaths(claimed);
  const issues = [];
  const files = [];
  const fileContents = new Map();

  if ((unitRequired || e2eRequiredAndAvailable) && claimedPaths.length === 0) {
    issues.push('Required test missing: required automated tests have no submitted test files.');
  }

  const changed = getImplementationChangedFiles(root, run);
  const changedSet = new Set(changed.files || []);
  const gitUsable = changed.source === 'git' && !changed.reason;

  for (const rel of claimedPaths) {
    const abs = path.resolve(root, rel);
    const relNorm = path.relative(root, abs).split(path.sep).join('/');
    if (!relNorm || relNorm.startsWith('..') || path.isAbsolute(relNorm)) {
      issues.push(`Test path is outside the repository: ${rel}`);
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      issues.push(`Required test missing: ${relNorm}`);
      continue;
    }
    if (!looksLikeTestFile(relNorm)) {
      issues.push(`Claimed path is not a test file: ${relNorm}`);
      continue;
    }
    if (gitUsable) {
      if (!changedSet.has(relNorm)) {
        issues.push(`Required test does not belong to the current implementation: ${relNorm}`);
        continue;
      }
    } else if (run.implementation_entered_at) {
      const mtime = fs.statSync(abs).mtimeMs;
      const entered = Date.parse(run.implementation_entered_at);
      if (Number.isFinite(entered) && mtime + 1000 < entered) {
        issues.push(`Required test does not belong to the current implementation: ${relNorm}`);
        continue;
      }
    }
    fileContents.set(relNorm, fs.readFileSync(abs, 'utf8'));
    files.push(relNorm);
  }

  const unitScenarioIds = unitRequired ? scenarioIds(session.testing.test_cases?.unit, 'T') : [];
  const e2eScenarioIds = e2eRequiredAndAvailable ? scenarioIds(session.testing.test_cases?.e2e, 'E') : [];
  const unitMatches = testFilesForScenarioIds(root, files, unitScenarioIds);
  const e2eFiles = files.filter((file) => looksLikeE2eTestFile(file, fileContents.get(file)));
  const e2eMatches = testFilesForScenarioIds(root, e2eFiles, e2eScenarioIds);

  for (const id of unitScenarioIds) {
    if (!unitMatches.has(id)) {
      issues.push(`Required unit scenario is not covered by a current-run test file: ${id}`);
    }
  }
  if (e2eRequiredAndAvailable && !e2eFiles.length) {
    issues.push('Required E2E test missing: submit a new current-run E2E test file.');
  }
  for (const id of e2eScenarioIds) {
    if (!e2eMatches.has(id)) {
      issues.push(`Required E2E scenario is not covered by a new current-run E2E test file: ${id}`);
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    files,
    unitRequired,
    e2eRequiredAndAvailable,
    unitMatches: Object.fromEntries(unitMatches),
    e2eMatches: Object.fromEntries(e2eMatches),
  };
}

function executedCheck(results, matcher) {
  return (results || []).find((r) => r.executed !== false && matcher(r));
}

export function evaluateExecutedTests(session, results = []) {
  const issues = [];
  const unitRequired = Boolean(session.testing.strategy?.unit?.required);
  const e2eRequired = Boolean(session.testing.strategy?.e2e?.required);
  const e2eAvailable = Boolean(session.testing.e2e.available);
  const executed = results.filter((r) => r && r.executed !== false);
  const unit = executedCheck(executed, (r) => /unit tests/i.test(r.name || ''));
  const e2e = executedCheck(executed, (r) => /e2e|playwright|cypress/i.test(`${r.name || ''} ${r.command || ''}`));

  if (unitRequired) {
    if (!unit) issues.push('Required test not executed: unit tests did not run.');
    else if (unit.status && unit.status !== 'Passed') {
      issues.push(`Failed required test: ${unit.name} (${unit.status}).`);
    }
  }
  if (e2eRequired && e2eAvailable) {
    if (!e2e) issues.push('Required test not executed: E2E tests did not run.');
    else if (e2e.status && e2e.status !== 'Passed') {
      issues.push(`Failed required test: ${e2e.name} (${e2e.status}).`);
    }
  }
  if (unit && unit.status && unit.status !== 'Passed') {
    issues.push(`Failed required test: ${unit.name} (${unit.status}).`);
  }
  if (e2e && e2e.status && e2e.status !== 'Passed') {
    issues.push(`Failed required test: ${e2e.name} (${e2e.status}).`);
  }
  return {
    ok: issues.length === 0,
    issues: [...new Set(issues)],
    e2eExecuted: Boolean(e2e && e2e.status === 'Passed'),
  };
}

function upsertMarkdownSection(content, heading, body) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const replacement = `${heading}\n\n${body.trim()}\n`;
  if (content.includes(heading)) {
    return content.replace(new RegExp(`${escaped}[\\s\\S]*?(?=\\n## |\\n$)`), replacement.trimEnd());
  }
  return `${content.trimEnd()}\n\n${replacement}`;
}

function executionForType(results = [], type) {
  const matcher =
    type === 'e2e'
      ? (r) => /e2e|playwright|cypress/i.test(`${r.name || ''} ${r.command || ''}`)
      : (r) => /unit tests/i.test(r.name || '');
  return (results || []).find((result) => matcher(result)) || null;
}

function scenarioAcId(id = '') {
  return String(id).match(/^(AC\d+)-/i)?.[1]?.toUpperCase() || '';
}

function refreshAutomatedCoverage(session, validated, results) {
  const rows = [];
  const unitResult = executionForType(results, 'unit');
  const e2eResult = executionForType(results, 'e2e');
  for (const [id, file] of Object.entries(validated.unitMatches || {})) {
    rows.push({
      acId: scenarioAcId(id),
      scenarioId: id,
      file,
      type: 'unit',
      result: unitResult?.status || 'Not Run',
      command: unitResult?.command || '',
    });
  }
  for (const [id, file] of Object.entries(validated.e2eMatches || {})) {
    rows.push({
      acId: scenarioAcId(id),
      scenarioId: id,
      file,
      type: 'e2e',
      result: e2eResult?.status || 'Not Run',
      command: e2eResult?.command || '',
    });
  }
  session.testing.automated_coverage = rows;
  return rows;
}

function renderScenarioCoverage(session, run) {
  const automated = session.testing.automated_coverage || [];
  const manual = session.testing.manual_qa?.case_results || [];
  const rows = [
    ...automated.map(
      (row) =>
        `| ${row.acId} | ${row.scenarioId} | ${run.id} | ${row.file}${row.command ? ` — ${row.command}` : ''} | ${row.result === 'Passed' ? 'PASS' : row.result} | ${nowIso()} |`
    ),
    ...manual.map(
      (row) =>
        `| ${row.acId} | ${row.scenarioId} | ${run.id} | Manual QA (user confirmed) | ${row.result} | ${row.confirmed_at || nowIso()} |`
    ),
  ];
  return [
    '| AC | Scenario ID | Run ID | Executed test / manual result | Status | Timestamp |',
    '|----|-------------|--------|-------------------------------|--------|-----------|',
    ...(rows.length ? rows : ['| — | — | — | No scenario evidence recorded | Not Run | — |']),
  ].join('\n');
}

function writeTestImplementationPlan(run, session) {
  const planPath = artifactPath(run.artifacts_dir, 'verification-plan');
  if (!fs.existsSync(planPath)) return;
  const rows = (session.testing.automated_coverage || []).map(
    (row) => `| ${row.acId} | ${row.scenarioId} | ${row.file} | ${row.scenarioId} |`
  );
  const body = [
    '| AC | Scenario ID | File / location | Test name / scenario covered |',
    '|----|-------------|-----------------|------------------------------|',
    ...(rows.length ? rows : ['| | | | |']),
  ].join('\n');
  const content = fs.readFileSync(planPath, 'utf8');
  fs.writeFileSync(planPath, upsertMarkdownSection(content, '## Test Implementation', body));
}

function writeValidatedTestEvidence(run, files, results, session = null, validated = null) {
  const evidencePath = artifactPath(run.artifacts_dir, 'verification-evidence');
  let content = fs.existsSync(evidencePath)
    ? fs.readFileSync(evidencePath, 'utf8')
    : `# Verification Evidence\n\n<!-- EOS_ARTIFACT_STATUS: draft -->\n\n- **Run ID:** ${run.id}\n`;
  if (!content.includes(`**Run ID:** ${run.id}`)) {
    content = content.replace(/\*\*Run ID:\*\*\s*\S+/, `**Run ID:** ${run.id}`);
  }
  const block = [
    '## Implementation test files',
    '',
    '| File | Exists | Belongs to implementation |',
    '|------|--------|---------------------------|',
    ...files.map((f) => `| ${f} | yes | yes |`),
    '',
    'File names alone are not evidence. Rows above were validated against the repository and current-run implementation changes.',
    '',
  ];
  if (content.includes('## Implementation test files')) {
    content = content.replace(
      /## Implementation test files[\s\S]*?(?=\n## |\n$)/,
      `${block.join('\n')}`
    );
  } else {
    content += `\n\n${block.join('\n')}`;
  }
  const execBlock = ['## Test execution', '', '```text'];
  for (const r of results) {
    execBlock.push(`$ ${r.command}`);
    execBlock.push(`exit: ${r.exitCode} — ${r.status}`);
    if (r.output) execBlock.push(String(r.output).trim());
    execBlock.push('');
  }
  if (!results.length) execBlock.push('(no automated checks executed)');
  execBlock.push('```', '');
  if (content.includes('## Test execution')) {
    content = content.replace(
      /## Test execution[\s\S]*?(?=\n## Scenario coverage|\n## Manual check|\n## Failures|\n## Implementation test files)/,
      `${execBlock.join('\n')}\n`
    );
  } else {
    content += `\n${execBlock.join('\n')}`;
  }
  if (session && validated) {
    refreshAutomatedCoverage(session, validated, results);
    content = upsertMarkdownSection(content, '## Scenario coverage', renderScenarioCoverage(session, run));
    writeTestImplementationPlan(run, session);
  }
  fs.writeFileSync(evidencePath, content);
}

export function recordManualQaEvidence(run) {
  const session = initFeatureSession(run);
  const manual = session.testing.manual_qa;
  const cases = scenarioIds(manual.cases, 'M');
  manual.case_results = cases.map((scenarioId) => ({
    acId: scenarioAcId(scenarioId),
    scenarioId,
    result: 'Passed',
    confirmed_at: manual.confirmed_at || nowIso(),
  }));
  const evidencePath = artifactPath(run.artifacts_dir, 'verification-evidence');
  let content = fs.existsSync(evidencePath)
    ? fs.readFileSync(evidencePath, 'utf8')
    : `# Verification Evidence\n\n<!-- EOS_ARTIFACT_STATUS: draft -->\n\n- **Run ID:** ${run.id}\n`;
  const manualRows = manual.case_results.map(
    (row) => `| ${row.acId} | ${row.scenarioId} | ${run.id} | Passed | User confirmed functional Manual QA in the feature conversation | ${row.confirmed_at} |`
  );
  const body = [
    '| AC | Scenario ID | Run ID | Result | Notes | Timestamp |',
    '|----|-------------|--------|--------|-------|-----------|',
    ...(manualRows.length ? manualRows : ['| — | — | — | Not Required | No manual scenarios | — |']),
  ].join('\n');
  content = upsertMarkdownSection(content, '## Manual check results', body);
  content = upsertMarkdownSection(content, '## Scenario coverage', renderScenarioCoverage(session, run));
  fs.writeFileSync(evidencePath, content);
  return manual.case_results;
}

export function recordImplementationAndVerify(root, state, { summary = '', testsCreated = [] } = {}) {
  const run = state.active_run;
  const session = initFeatureSession(run);
  if (run.current_phase !== 'implement' || !run.implementation_entered_at) {
    return { ok: false, error: 'Implementation is not authorized for this run.' };
  }
  if (hasPendingWorkflowDecisions(run)) {
    return { ok: false, error: 'Unresolved workflow decisions require explicit user input.' };
  }

  const validated = validateImplementationTestFiles(root, run, testsCreated);
  const caps = state.capabilities || detectCapabilities(root);
  const testCaps = state.test_capabilities || detectTestCapabilities(root, caps);
  const results = runEngineeringChecks(root, caps, testCaps, { strategy: session.testing.strategy }).map((r) => ({
    ...r,
    executed: true,
  }));
  const execution = evaluateExecutedTests(session, results);

  session.implementation.tests_created = validated.files;
  session.implementation.automated_results = results;
  session.testing.e2e.executed = Boolean(
    session.testing.e2e.available && execution.e2eExecuted
  );

  const issues = [...validated.issues, ...execution.issues];
  session.implementation.blocked_reasons = issues;
  if (issues.length) {
    session.implementation.summary = null;
    writeValidatedTestEvidence(run, validated.files, results, session, validated);
    return { ok: false, error: issues.join(' '), issues, results };
  }

  session.implementation.summary = summary || 'Implementation reported.';
  clearBlockersByType(run, IMPLEMENTATION_EVIDENCE_BLOCKERS);
  writeValidatedTestEvidence(run, validated.files, results, session, validated);
  return { ok: true, results, files: validated.files };
}

export function syncRegressionPlanToVerificationPlan(root, run, regressionImpact = { candidates: [] }) {
  const planPath = artifactPath(run.artifacts_dir, 'verification-plan');
  if (!fs.existsSync(planPath)) return null;
  const session = initFeatureSession(run);
  const caps = detectCapabilities(root);
  const regressionStrategy =
    session.regression.strategy ||
    decideRegressionStrategy({
      regressionImpact,
      capabilities: caps,
      featureStrategy: session.testing.strategy,
    });
  const cases =
    session.regression.cases ||
    generateRegressionScenarios({ regressionImpact, regressionStrategy });
  const qaScope =
    session.regression.manual ||
    generateQaRegressionScope({ regressionScenarios: cases, regressionStrategy });
  let planContent = fs.readFileSync(planPath, 'utf8');
  planContent = applyRegressionSectionsToPlan(planContent, [
    ['## Regression Strategy', renderRegressionStrategySection(regressionStrategy)],
    ['## Regression Scenarios', renderRegressionScenariosSection(cases, { required: regressionStrategy.required })],
    ['## QA Regression Scope', renderQaRegressionScopeSection(qaScope)],
  ]);
  fs.writeFileSync(planPath, planContent);
  return planPath;
}

export function recordRegressionFromImpact(root, run, resolved, regressionImpact = { candidates: [] }) {
  const session = initFeatureSession(run);
  const caps = detectCapabilities(root);
  const regressionStrategy = decideRegressionStrategy({
    regressionImpact,
    capabilities: caps,
    featureStrategy: resolved?.strategy || session.testing.strategy,
  });
  const cases = generateRegressionScenarios({ regressionImpact, regressionStrategy });
  const qaScope = generateQaRegressionScope({ regressionScenarios: cases, regressionStrategy });
  session.regression.cases = cases;
  session.regression.manual = qaScope;
  session.regression.strategy = regressionStrategy;
  // Keep the computed blast radius so the regression impact map can be rendered in
  // chat and embedded in the durable completion record.
  session.regression.impact = regressionImpact;
  session.regression.automated_results = [];
  session.regression.case_results = [];
  session.regression.presented = true;
  if (!(qaScope || []).length) {
    session.regression.confirmed = true;
    session.regression.confirmed_at = session.regression.confirmed_at || nowIso();
  }
  syncRegressionPlanToVerificationPlan(root, run, regressionImpact);
  return session.regression;
}

function normalizeRepoRelative(root, relPath = '') {
  const abs = path.resolve(root, relPath);
  return path.relative(root, abs).split(path.sep).join('/');
}

function walkTestFiles(root, dirRel, visitor) {
  const absDir = path.join(root, dirRel);
  if (!fs.existsSync(absDir)) return;
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = path.join(dirRel, entry.name).split(path.sep).join('/');
    if (entry.isDirectory()) {
      walkTestFiles(root, rel, visitor);
      continue;
    }
    if (entry.isFile()) visitor(rel);
  }
}

/** Test files that belong to the current implementation run (git diff or post-implement mtime). */
export function listCurrentRunTestFiles(root, run) {
  const session = initFeatureSession(run);
  const changed = getImplementationChangedFiles(root, run);
  const gitUsable = changed.source === 'git' && !changed.reason;
  const files = new Set();
  const add = (relPath) => {
    const relNorm = normalizeRepoRelative(root, relPath);
    if (!relNorm || relNorm.startsWith('..') || !looksLikeTestFile(relNorm)) return;
    const abs = path.join(root, relNorm);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
    files.add(relNorm);
  };

  for (const rel of session.implementation.tests_created || []) add(rel);

  if (gitUsable) {
    for (const rel of changed.files || []) add(rel);
    return [...files];
  }

  if (run.implementation_entered_at) {
    const entered = Date.parse(run.implementation_entered_at);
    for (const dir of ['src', 'tests', 'test', 'e2e', '__tests__']) {
      walkTestFiles(root, dir, (rel) => {
        const abs = path.join(root, rel);
        const mtime = fs.statSync(abs).mtimeMs;
        if (Number.isFinite(entered) && mtime + 1000 >= entered) add(rel);
      });
    }
  }

  return [...files];
}

function currentRunTestFiles(root, run) {
  return listCurrentRunTestFiles(root, run);
}

function writeRegressionEvidence(run, session) {
  const evidencePath = artifactPath(run.artifacts_dir, 'verification-evidence');
  let content = fs.existsSync(evidencePath)
    ? fs.readFileSync(evidencePath, 'utf8')
    : `# Verification Evidence\n\n<!-- EOS_ARTIFACT_STATUS: draft -->\n\n- **Run ID:** ${run.id}\n`;
  const rows = (session.regression.case_results || []).map(
    (result) =>
      `| ${result.regId} | ${result.testReference} | ${run.id} | ${result.status} | ${result.evidence} |`
  );
  const body = [
    '| REG ID | Test / manual reference | Run ID | Status | Evidence |',
    '|--------|-------------------------|--------|--------|----------|',
    ...(rows.length ? rows : ['| — | — | — | Not Run | No regression cases require evidence |']),
  ].join('\n');
  content = upsertMarkdownSection(content, '## Regression execution evidence', body);
  fs.writeFileSync(evidencePath, content);
}

function writeRegressionImplementationPlan(run, session) {
  const planPath = artifactPath(run.artifacts_dir, 'verification-plan');
  if (!fs.existsSync(planPath)) return;
  const rows = (session.regression.case_results || [])
    .filter((result) => result.automated)
    .map(
      (result) =>
        `| ${result.regId} | ${result.testReference} | automated regression | ${result.status} |`
    );
  const body = [
    '| REG ID | Test File / Reference | Test Type | Status |',
    '|--------|----------------------|-----------|--------|',
    ...(rows.length ? rows : ['| | | | |']),
  ].join('\n');
  const content = fs.readFileSync(planPath, 'utf8');
  fs.writeFileSync(planPath, upsertMarkdownSection(content, '## Regression Test Implementation', body));
}

/**
 * Execute and persist current-run evidence for every generated regression case.
 * A generic implementation test result is never reused as regression evidence:
 * each automated REG case must be named in a new current-run test file.
 */
export function recordRegressionEvidence(root, state) {
  const run = state.active_run;
  const session = initFeatureSession(run);
  const cases = session.regression.cases || [];
  const testFiles = currentRunTestFiles(root, run);
  const results = runEngineeringChecks(
    root,
    state.capabilities || detectCapabilities(root),
    state.test_capabilities || detectTestCapabilities(root, state.capabilities || detectCapabilities(root)),
    { strategy: session.testing.strategy }
  ).map((result) => ({
    ...result,
    name: `Regression: ${result.name}`,
    executed: true,
    purpose: 'regression',
  }));
  const passed = results.filter((result) => result.status === 'Passed');
  const issues = [];
  const caseResults = [];

  for (const scenario of cases) {
    const automated = Boolean(scenario.automated);
    const manual = Boolean(scenario.manual);
    let testReference = 'Manual QA';
    let status = 'Passed';
    let evidence = 'User confirmed current-run manual regression.';

    if (automated) {
      const match = testFiles.find((file) => {
        const content = fs.readFileSync(path.resolve(root, file), 'utf8');
        return new RegExp(`\\b${scenario.regId}\\b`, 'i').test(content);
      });
      if (!match) {
        status = 'Not Run';
        evidence = 'Missing current-run regression test file containing the REG scenario ID.';
        issues.push(`Required regression test is not covered by a current-run test file: ${scenario.regId}`);
      } else if (!passed.length) {
        testReference = match;
        status = 'Not Run';
        evidence = 'No passing automated command executed for this current run.';
        issues.push(`Required regression test did not pass: ${scenario.regId}`);
      } else {
        testReference = match;
        status = 'Passed';
        evidence = `Current-run regression execution passed for ${scenario.regId} via ${match}.`;
      }
    }

    if (manual && !session.regression.confirmed) {
      if (!automated) {
        status = 'Not Run';
        evidence = 'Manual regression has not been confirmed in this conversation.';
      } else {
        status = 'Not Run';
        evidence = 'Automated evidence exists, but required manual regression has not been confirmed.';
      }
      issues.push(`Required manual regression is not confirmed: ${scenario.regId}`);
    }

    caseResults.push({
      regId: scenario.regId,
      automated,
      manual,
      testReference,
      status,
      evidence,
    });
  }

  session.regression.automated_results = results;
  session.regression.case_results = caseResults;
  syncRegressionPlanToVerificationPlan(root, run, {
    candidates: cases.map((scenario) => ({
      changedPath: scenario.changedPath,
      consumerPath: scenario.consumerPath,
      consumerKind: scenario.consumerKind,
      flow: scenario.flow,
      risk: scenario.priority || scenario.riskClassification || 'medium',
    })),
  });
  writeRegressionImplementationPlan(run, session);
  writeRegressionEvidence(run, session);
  return { ok: issues.length === 0, issues, results, caseResults };
}

export function canLeaveImplementForVerify(run) {
  const session = initFeatureSession(run);
  if (run.current_phase !== 'implement' || !run.implementation_entered_at) {
    return { ok: false, reason: 'Implement phase has not been entered authoritatively.' };
  }
  if (!session.implementation.summary) {
    return { ok: false, reason: 'Implementation evidence has not been validated.' };
  }
  if ((session.implementation.blocked_reasons || []).length) {
    return { ok: false, reason: session.implementation.blocked_reasons.join(' ') };
  }
  if (manualQaPending(session)) {
    return { ok: false, reason: 'required manual QA pending' };
  }
  if (regressionEvidencePending(session) || regressionManualPending(session)) {
    return { ok: false, reason: 'required regression pending' };
  }
  const cases = session.regression.cases || [];
  if (cases.length && !(session.regression.case_results || []).length) {
    return { ok: false, reason: 'required regression pending' };
  }
  const regressionIncomplete = (session.regression.case_results || []).filter(
    (result) => result.status !== 'Passed'
  );
  if (regressionIncomplete.length) {
    return {
      ok: false,
      reason: `Regression evidence incomplete: ${regressionIncomplete.map((result) => result.regId).join(', ')}`,
    };
  }
  const failed = (session.implementation.automated_results || []).filter(
    (r) => r.status && r.status !== 'Passed' && r.status !== 'Infrastructure Failed'
  );
  if (failed.length) {
    return { ok: false, reason: `Failed required test: ${failed.map((r) => r.name).join(', ')}` };
  }
  return { ok: true };
}

export function continueAfterImplementationGates(root, home, state) {
  const run = state.active_run;
  const session = initFeatureSession(run);
  evaluateFeatureStage(run);
  if (manualQaPending(session)) {
    return { ok: true, pending: 'manual_qa', reason: 'required manual QA pending', phase: run.current_phase };
  }
  if (regressionManualPending(session)) {
    return { ok: true, pending: 'regression', reason: 'required regression pending', phase: run.current_phase };
  }
  const regression = recordRegressionEvidence(root, state);
  if (!regression.ok) {
    evaluateFeatureStage(run);
    return {
      ok: true,
      pending: 'regression',
      reason: 'required regression pending',
      issues: regression.issues,
      phase: run.current_phase,
    };
  }
  return advanceImplementToVerify(root, home, state);
}

function inferPrimarySymbol(root, relPath = '') {
  const fullPath = path.join(root, relPath);
  if (!fs.existsSync(fullPath)) return '';
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const patterns = [
      /export\s+default\s+function\s+(\w+)/,
      /export\s+function\s+(\w+)/,
      /export\s+default\s+class\s+(\w+)/,
      /export\s+class\s+(\w+)/,
      /export\s+(?:const|let)\s+(\w+)/,
    ];
    for (const pattern of patterns) {
      const match = content.match(pattern);
      if (match?.[1]) return match[1];
    }
  } catch {
    return '';
  }
  return '';
}

function implementationReferencesVerified(root, reviewText = '') {
  const refs = parseImplementationReferences(reviewText);
  return (
    refs.length > 0 &&
    refs.every((ref) => verifyRepositoryReference(root, ref.file, ref.symbol).repositoryVerified)
  );
}

/**
 * Source files changed by the current implementation run that expose an inferable
 * exported symbol. Used to map each AC to a repository-verifiable implementation
 * reference derived from what was actually implemented, rather than guessing from a
 * hardcoded example-app file list (which left real features stuck at verify because
 * the generated reference could never be repository-verified).
 */
export function discoverImplementationSourceFiles(root, run, session = initFeatureSession(run)) {
  const files = [];
  const seen = new Set();
  const consider = (rel) => {
    const norm = normalizeRepoRelative(root, rel);
    if (!norm || norm.startsWith('..') || seen.has(norm)) return;
    seen.add(norm);
    if (looksLikeTestFile(norm)) return;
    const abs = path.join(root, norm);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) return;
    if (inferPrimarySymbol(root, norm)) files.push(norm);
  };
  const changed = getImplementationChangedFiles(root, run);
  if (changed.source === 'git' && !changed.reason) {
    for (const rel of changed.files || []) consider(rel);
  }
  for (const rel of session.implementation?.tests_created || []) consider(rel);
  return files;
}

export function ensureImplementationReviewNotes(root, run) {
  const reviewPath = artifactPath(run.artifacts_dir, 'review-notes');
  let content = fs.existsSync(reviewPath)
    ? fs.readFileSync(reviewPath, 'utf8')
    : `# Review Notes\n\n<!-- EOS_ARTIFACT_STATUS: draft -->\n\n- **Run ID:** ${run.id}\n`;
  if (implementationReferencesVerified(root, content)) return reviewPath;
  reapplyAnsweredClarificationsToContract(run);
  const contract = fs.readFileSync(artifactPath(run.artifacts_dir, 'feature-contract'), 'utf8');
  const acs = extractAcceptanceCriteria(contract);
  const session = initFeatureSession(run);
  // Prefer real, current-run implementation source files (git-derived) so each AC maps
  // to a repository-verifiable file+symbol. Fall back only when no changed source file
  // with an inferable symbol is available (e.g. git unavailable): use any implementation
  // file the run itself reported. No repository-specific paths are assumed.
  const implFiles = discoverImplementationSourceFiles(root, run, session);
  const reported = session.implementation.tests_created || [];
  const fallbackFile =
    reported.find((rel) => !looksLikeTestFile(rel) && fs.existsSync(path.join(root, rel))) ||
    reported.find((rel) => fs.existsSync(path.join(root, rel))) ||
    reported[0] ||
    'src/implementation';
  const rows = acs.map((ac, idx) => {
    const file = implFiles.length ? implFiles[idx % implFiles.length] : fallbackFile;
    const symbol = inferPrimarySymbol(root, file);
    return `| AC${idx + 1} | ${file} | ${symbol || '—'} | ${ac.replace(/\|/g, '/')} |`;
  });
  const body = [
    '| AC | File | Symbol | Description |',
    '|----|------|--------|-------------|',
    ...(rows.length ? rows : ['| AC1 | src/feature.test.js | | Feature implementation |']),
  ].join('\n');
  content = upsertMarkdownSection(content, '## Implementation references', body);
  fs.writeFileSync(reviewPath, content);
  return reviewPath;
}

export function advanceImplementToVerify(root, home, state) {
  const run = state.active_run;
  const check = canLeaveImplementForVerify(run);
  if (!check.ok) return check;
  reapplyAnsweredClarificationsToContract(run);
  ensureImplementationReviewNotes(root, run);
  clearBlockersByType(run, ['verification']);
  run.blocked = hasBlockers(run);
  saveState(root, state);
  cmdVerifyRun(root, { silent: true });
  const result = runAuthoritativeCompletePhase(root, home, state);
  if (!result.ok) return result;
  clearBlockersByType(run, ['verification']);
  run.blocked = hasBlockers(run);
  saveState(root, state);
  cmdVerifyReport(root, { silent: true });
  const latest = loadState(root);
  if (latest?.active_run) {
    state.active_run = latest.active_run;
    Object.assign(run, latest.active_run);
  }
  if (!verificationIsReady(run)) {
    addBlocker(
      run,
      'verification',
      (run.verification_result?.reasons || ['Verification incomplete']).join(' ')
    );
  } else {
    clearBlockersByType(run, ['verification', 'required_tests', 'regression']);
    run.blocked = hasBlockers(run);
  }
  evaluateFeatureStage(run);
  saveState(root, state);
  return { ok: true, phase: run.current_phase, verification: run.verification_result, cleanup: result.cleanup };
}

function appendArtifactSection(filePath, heading, body) {
  let content = fs.existsSync(filePath)
    ? fs.readFileSync(filePath, 'utf8')
    : `${heading}\n\n<!-- EOS_ARTIFACT_STATUS: draft -->\n`;
  if (!content.includes(heading.replace(/^# /, '').trim()) && content.indexOf(heading) !== 0) {
    content += `\n\n${heading}\n`;
  }
  content += `\n${body}\n`;
  fs.writeFileSync(filePath, content);
}

export function confirmReviewFromConversation(root, home, state) {
  const run = state.active_run;
  if (run.current_phase !== 'verify') {
    return { ok: false, error: 'Review can only be confirmed during the verify phase.' };
  }
  if (!verificationIsReady(run)) {
    addBlocker(run, 'review', 'Review is blocked until current-run verification is READY FOR REVIEW.');
    return { ok: false, error: 'verification incomplete' };
  }
  const reviewPath = artifactPath(run.artifacts_dir, 'review-notes');
  appendArtifactSection(
    reviewPath,
    '## Conversational review',
    `- Confirmed in chat at ${nowIso()} for run ${run.id}.\n- Verification status: ${run.verification_result.status}.`
  );
  markArtifactStatus(reviewPath, 'complete');
  const evidencePath = artifactPath(run.artifacts_dir, 'verification-evidence');
  if (fs.existsSync(evidencePath)) {
    markArtifactStatus(evidencePath, 'complete');
  }
  const result = runAuthoritativeCompletePhase(root, home, state);
  if (!result.ok) return result;
  return { ok: true, phase: run.current_phase, cleanup: result.cleanup };
}

export function confirmDeliveryFromConversation(root, home, state) {
  const run = state.active_run;
  if (run.current_phase !== 'review' && run.current_phase !== 'deliver') {
    return { ok: false, error: 'Delivery can only be confirmed after review has started.' };
  }
  if (!verificationIsReady(run)) {
    addBlocker(run, 'delivery', 'Delivery is blocked until current-run verification is READY FOR REVIEW.');
    return { ok: false, error: 'verification incomplete' };
  }
  const deliverySession = initFeatureSession(run);
  if (regressionManualPending(deliverySession)) {
    addBlocker(run, 'regression', 'Required manual regression is pending.');
    return { ok: false, error: 'required regression pending' };
  }
  // Regression cases were generated for this run, so the run cannot be reported as
  // delivered until each one carries evidence. This stops a run being closed out while
  // the regression step was never actually surfaced or executed.
  const regressionCases = deliverySession.regression?.cases || [];
  const regressionResults = deliverySession.regression?.case_results || [];
  if (regressionCases.length && !regressionResults.length) {
    addBlocker(
      run,
      'regression',
      `Delivery blocked: ${regressionCases.length} regression case(s) were generated but none have recorded evidence.`
    );
    return { ok: false, error: 'regression evidence missing' };
  }

  const deliveryPath = artifactPath(run.artifacts_dir, 'delivery-preparation');
  appendArtifactSection(
    deliveryPath,
    '## Conversational delivery sign-off',
    `- Confirmed in chat at ${nowIso()} for run ${run.id}.\n- Verification status: ${run.verification_result.status}.`
  );
  markArtifactStatus(deliveryPath, 'signed-off');
  ensureGateApproved(run, 'delivery-signoff', 'Conversational delivery confirmation');

  if (run.current_phase === 'review') {
    const reviewResult = runAuthoritativeCompletePhase(root, home, state);
    if (!reviewResult.ok) return reviewResult;
  }
  if (run.status === 'completed') {
    return { ok: true, completed: true, cleanup: null };
  }
  const result = runAuthoritativeCompletePhase(root, home, state);
  if (!result.ok) return result;
  return { ok: true, completed: Boolean(result.completed), phase: run.current_phase, cleanup: result.cleanup };
}

export function refreshVerificationFromConversation(root, state) {
  let run = state.active_run;
  if (run.current_phase !== 'verify') {
    return { ok: false, error: 'Verification refresh is only valid during the verify phase.' };
  }
  // Also clear review/delivery blockers left by a premature confirmation: they are
  // re-added by the review/delivery confirmation paths if verification is still not
  // READY, so clearing them here never bypasses a real gate but lets a corrected run
  // recover instead of staying permanently BLOCKED.
  clearBlockersByType(run, ['verification', 'review', 'delivery']);
  run.blocked = hasBlockers(run);
  saveState(root, state);
  cmdVerifyRun(root, { silent: true });
  cmdVerifyReport(root, { silent: true });
  const latest = loadState(root);
  if (latest?.active_run) {
    state.active_run = latest.active_run;
    run = state.active_run;
  }
  if (verificationIsReady(run)) {
    clearBlockersByType(run, ['verification']);
    run.blocked = hasBlockers(run);
  } else {
    addBlocker(
      run,
      'verification',
      (run.verification_result?.reasons || ['Verification incomplete']).join(' ')
    );
    run.blocked = hasBlockers(run);
  }
  saveState(root, state);
  return { ok: true, verification: run.verification_result };
}
