/**
 * Regression verification — parallel to AC requirement verification.
 */

import {
  parseRegressionExecutionEvidence,
  parseEvidenceRunId,
} from './requirementVerification.js';
import {
  parseRegressionStrategyFromPlan,
  parseRegressionScenariosFromPlan,
  parseRegressionTestImplementation,
  parseQaRegressionScope,
  REG_SCENARIO_ID_RE,
} from './intelligence/regressionImpact.js';
import {
  parseChangedRegIdsFromEvidence,
  parseReconciledRegIdsFromEvidence,
} from './intelligence/regressionReconciliation.js';
import { VERIFICATION_STATE } from './verificationStates.js';

export { parseRegressionExecutionEvidence };

function isCurrentRunEvidence({ runId, evidenceRunId }, currentRunId) {
  if (!currentRunId) return true;
  const effective = runId || evidenceRunId;
  if (!effective) return false;
  return effective === currentRunId;
}

export function mapRegressionScenario(scenario, ctx) {
  const {
    regressionStrategy = {},
    testImpls = [],
    executionRows = [],
    qaScope = [],
    currentRunId = '',
    evidenceRunId = '',
    changedRegIds = [],
  } = ctx;

  if (!regressionStrategy.required) {
    return {
      regId: scenario.regId,
      status: 'NotRequired',
      executionState: VERIFICATION_STATE.NOT_APPLICABLE,
      planned: false,
      implemented: false,
      executed: false,
      passed: false,
      failed: false,
      notRun: false,
      notRequired: true,
      reason: 'Regression strategy is Not Required',
    };
  }

  const planned = Boolean(
    scenario.regId &&
      REG_SCENARIO_ID_RE.test(scenario.regId) &&
      /^(high|medium|low)$/i.test(scenario.riskClassification || scenario.priority || '') &&
      scenario.classification
  );
  const needsAutomated = scenario.automated && regressionStrategy.automatedRequired;
  const needsManual = scenario.manual && regressionStrategy.manualRequired;

  const impl = testImpls.find((t) => t.regId === scenario.regId);
  const implemented = !needsAutomated || Boolean(impl?.file?.trim() && !/^pending$/i.test(impl.status || ''));

  const currentExec = executionRows.filter((r) =>
    isCurrentRunEvidence(
      { runId: r.runId || evidenceRunId, evidenceRunId: r.runId || evidenceRunId },
      currentRunId
    )
  );
  const execRow = currentExec.find((r) => r.regId === scenario.regId);
  const executionReferenceMatches =
    !needsAutomated ||
    Boolean(
      impl?.file?.trim() &&
        execRow?.testReference?.trim() &&
        impl.file.trim() === execRow.testReference.trim()
    );
  const classificationChanged = changedRegIds.includes(scenario.regId);
  const reconciledExecution =
    !classificationChanged || /reconciled|updated blast radius/i.test(execRow?.evidence || '');
  const staleExec = executionRows.some(
    (r) =>
      r.regId === scenario.regId &&
      r.runId &&
      currentRunId &&
      r.runId !== currentRunId &&
      /^pass(?:ed)?$/i.test(r.status || '')
  );

  const qaItem = qaScope.find((q) => q.regId === scenario.regId || q.label.includes(scenario.regId));
  const manualPass =
    needsManual &&
    currentExec.some(
      (r) => r.regId === scenario.regId && /^pass(?:ed)?$/i.test(String(r.status || '').trim())
    );

  let executionState = VERIFICATION_STATE.NOT_RUN;
  if (!implemented && needsAutomated) {
    executionState = VERIFICATION_STATE.NOT_RUN;
  } else if (execRow && /^fail(?:ed)?$/i.test(String(execRow.status || '').trim())) {
    executionState = VERIFICATION_STATE.FAIL;
  } else if (needsAutomated && needsManual) {
    const autoPass = execRow && /^pass(?:ed)?$/i.test(String(execRow.status || '').trim());
    if (autoPass && manualPass) executionState = VERIFICATION_STATE.PASS;
  } else if (needsAutomated) {
    if (execRow && /^pass(?:ed)?$/i.test(String(execRow.status || '').trim())) executionState = VERIFICATION_STATE.PASS;
  } else if (needsManual) {
    if (manualPass || (execRow && /^pass(?:ed)?$/i.test(String(execRow.status || '').trim()))) {
      executionState = VERIFICATION_STATE.PASS;
    }
  } else if (execRow && /^pass(?:ed)?$/i.test(String(execRow.status || '').trim())) {
    executionState = VERIFICATION_STATE.PASS;
  }

  if ((staleExec && !execRow) || !reconciledExecution || !executionReferenceMatches) {
    executionState = VERIFICATION_STATE.NOT_RUN;
  }

  let status = 'Missing';
  if (executionState === VERIFICATION_STATE.FAIL) status = 'Failed';
  else if (executionState === VERIFICATION_STATE.PASS) status = 'Passed';
  else if (planned && implemented) status = 'Implemented';
  else if (planned) status = 'Planned';

  return {
    regId: scenario.regId,
    changedPath: scenario.changedPath,
    consumerPath: scenario.consumerPath,
    status,
    executionState,
    planned,
    implemented,
    executed: Boolean(execRow),
    passed: executionState === VERIFICATION_STATE.PASS,
    failed: executionState === VERIFICATION_STATE.FAIL,
    notRun: executionState === VERIFICATION_STATE.NOT_RUN,
    notRequired: false,
    staleEvidence: Boolean(staleExec && !execRow),
    classificationChanged,
    reconciliationEvidenceRequired: classificationChanged && !reconciledExecution,
    executionReferenceMismatch: Boolean(execRow && !executionReferenceMatches),
    testReference: impl?.file || execRow?.executed || null,
    evidenceReference: execRow ? `${execRow.executed}: ${execRow.status}` : null,
  };
}

export function buildRegressionCoverage(ctx) {
  const {
    planText = '',
    evidenceText = '',
    runId = '',
  } = ctx;

  const regressionStrategy = parseRegressionStrategyFromPlan(planText);
  let scenarios = parseRegressionScenariosFromPlan(planText);
  const reconciledIds = parseReconciledRegIdsFromEvidence(evidenceText);
  if (reconciledIds?.length) {
    scenarios = scenarios.filter((s) => reconciledIds.includes(s.regId));
  }
  const testImpls = parseRegressionTestImplementation(planText);
  const qaScope = parseQaRegressionScope(planText);
  const executionRows = parseRegressionExecutionEvidence(evidenceText);
  const evidenceRunId = parseEvidenceRunId(evidenceText);
  const changedRegIds = parseChangedRegIdsFromEvidence(evidenceText);

  if (!regressionStrategy.required) {
    return [
      {
        regId: 'REG-000',
        status: 'NotRequired',
        executionState: VERIFICATION_STATE.NOT_APPLICABLE,
        notRequired: true,
        planned: false,
        implemented: false,
        executed: false,
        passed: false,
        failed: false,
        notRun: false,
      },
    ];
  }

  return scenarios.map((scenario) =>
    mapRegressionScenario(scenario, {
      regressionStrategy,
      testImpls,
      executionRows,
      qaScope,
      currentRunId: runId,
      evidenceRunId,
      changedRegIds,
    })
  );
}

export function summarizeRegressionCoverage(coverage) {
  const counts = {
    Planned: 0,
    Implemented: 0,
    Passed: 0,
    Failed: 0,
    NotRun: 0,
    NotRequired: 0,
  };
  for (const c of coverage) {
    if (c.notRequired || c.executionState === VERIFICATION_STATE.NOT_APPLICABLE) {
      counts.NotRequired++;
      continue;
    }
    if (c.executionState === VERIFICATION_STATE.PASS) counts.Passed++;
    else if (c.executionState === VERIFICATION_STATE.FAIL) counts.Failed++;
    else if (c.executionState === VERIFICATION_STATE.NOT_RUN) counts.NotRun++;
    if (c.planned) counts.Planned++;
    if (c.implemented) counts.Implemented++;
  }
  return counts;
}

export function findUnresolvedRegression(coverage, regressionStrategy) {
  if (!regressionStrategy?.required) return [];
  const active = coverage.filter((c) => !c.notRequired);
  if (!active.length) return ['regression required but no REG scenarios found'];
  const reasons = [];
  for (const c of active) {
    const gaps = [];
    if (!c.planned) gaps.push('not planned');
    if (regressionStrategy.automatedRequired && !c.implemented) {
      gaps.push('automated implementation missing');
    }
    if (c.staleEvidence) gaps.push('only stale previous-run regression evidence');
    if (c.reconciliationEvidenceRequired) {
      gaps.push('changed blast-radius classification requires reconciled current-run evidence');
    }
    if (c.executionReferenceMismatch) {
      gaps.push('execution evidence does not match automated implementation reference');
    }
    if (c.executionState === VERIFICATION_STATE.NOT_RUN) gaps.push('execution not recorded for current run');
    if (c.executionState === VERIFICATION_STATE.FAIL) gaps.push('regression execution failed');
    if (gaps.length) reasons.push(`${c.regId}: ${gaps.join(', ')}`);
  }
  return reasons;
}

export function regressionGateSatisfied(coverage, regressionStrategy) {
  if (!regressionStrategy?.required) return { ok: true, reasons: [] };
  const reasons = findUnresolvedRegression(coverage, regressionStrategy);
  const active = coverage.filter((c) => !c.notRequired);
  const allPassed = active.length > 0 && active.every((c) => c.executionState === VERIFICATION_STATE.PASS);
  if (reasons.length || !allPassed) {
    return { ok: false, reasons: reasons.length ? reasons : ['regression verification incomplete'] };
  }
  return { ok: true, reasons: [] };
}
