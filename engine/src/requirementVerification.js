import fs from 'node:fs';
import path from 'node:path';
import { extractAcceptanceCriteria } from './intelligence/verificationMatrix.js';
import {
  SCENARIO_ID_RE,
  parseScenariosFromPlan,
  scenariosForAc,
} from './intelligence/testStrategy.js';
import { fileExists } from './paths.js';
import {
  VERIFICATION_STATE,
} from './verificationStates.js';

const GENERIC_SCENARIO_RE =
  /^(feature works correctly|works as expected|happy path|basic functionality|implemented|tested|working|manual qa passed)$/i;
const AC_ID_RE = /^AC(\d+)$/i;

export function assignAcIds(acceptanceCriteria) {
  return acceptanceCriteria.map((requirement, idx) => ({
    acId: `AC${idx + 1}`,
    requirement,
  }));
}

export function parseTestStrategy(planText = '') {
  const unit = /Unit Tests:\s*(Required|Not Required)/i.exec(planText);
  const e2e = /E2E Tests:\s*(Required|Not Required)/i.exec(planText);
  const manual = /Manual QA:\s*(Required|Not Required)/i.exec(planText);
  return {
    unitRequired: unit?.[1]?.toLowerCase() === 'required',
    e2eRequired: e2e?.[1]?.toLowerCase() === 'required',
    manualRequired: manual?.[1]?.toLowerCase() !== 'not required',
  };
}

export function parseEvidenceRunId(evidenceText = '') {
  const m = evidenceText.match(/\*\*Run ID:\*\*\s*(\S+)/);
  return m ? m[1].trim() : null;
}

export function isCurrentRunEvidence({ runId, evidenceRunId }, currentRunId) {
  if (!currentRunId) return false;
  const effective = runId || evidenceRunId;
  if (!effective) return false;
  return effective === currentRunId;
}

export function verifyRepositoryReference(consumerRoot, filePath, symbol = '') {
  if (!filePath || !String(filePath).trim()) {
    return { referenced: false, repositoryVerified: false, reason: 'missing file path' };
  }
  const normalized = String(filePath).trim().replace(/^\.\//, '');
  const fullPath = path.join(consumerRoot, normalized);
  if (!fileExists(fullPath)) {
    return { referenced: true, repositoryVerified: false, reason: 'file not found' };
  }
  if (!symbol || !String(symbol).trim()) {
    return { referenced: true, repositoryVerified: true, reason: 'file exists' };
  }
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const sym = String(symbol).trim();
    const patterns = [
      new RegExp(`\\bfunction\\s+${sym}\\b`),
      new RegExp(`\\bclass\\s+${sym}\\b`),
      new RegExp(`\\bconst\\s+${sym}\\b`),
      new RegExp(`\\blet\\s+${sym}\\b`),
      new RegExp(`\\bexport\\s+(?:default\\s+)?function\\s+${sym}\\b`),
      new RegExp(`\\bexport\\s+(?:const|let|class|function)\\s+${sym}\\b`),
      new RegExp(`\\b${sym}\\s*\\(`),
    ];
    const found = patterns.some((p) => p.test(content));
    return {
      referenced: true,
      repositoryVerified: found,
      reason: found ? 'file and symbol found' : 'symbol not found in file',
    };
  } catch {
    return { referenced: true, repositoryVerified: false, reason: 'unable to read file' };
  }
}

function escapeRegExp(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function executionMatchesImplementation(row, implementation) {
  const executed = String(row?.executed || '').toLowerCase();
  const file = String(implementation?.file || '').trim().toLowerCase();
  if (!file || !executed.includes(file)) return false;
  const testName = String(implementation?.testName || '').trim().toLowerCase();
  if (testName && executed.includes(testName)) return true;
  const scenarioId = String(implementation?.scenarioId || '').trim().toLowerCase();
  if (scenarioId && String(row?.scenarioId || '').trim().toLowerCase() === scenarioId) return true;
  return false;
}

export function verifyTestImplementationReference(
  consumerRoot,
  { file = '', testName = '', scenarioId = '' } = {}
) {
  if (!file?.trim()) {
    return { repositoryVerified: false, reason: 'missing test file path' };
  }
  if (!testName?.trim()) {
    return { repositoryVerified: false, reason: 'missing test name' };
  }
  if (!scenarioId?.trim()) {
    return { repositoryVerified: false, reason: 'missing scenario ID' };
  }
  const normalized = String(file).trim().replace(/^\.\//, '');
  const looksLikeTestFile =
    /(^|\/)(test|tests|__tests__)\//i.test(normalized) ||
    /\.(test|spec)\.[cm]?[jt]sx?$/i.test(normalized) ||
    /(^|\/)test_[^/]+\.py$/i.test(normalized) ||
    /Test\.java$/i.test(normalized);
  if (!looksLikeTestFile) {
    return { repositoryVerified: false, reason: 'reference is not a recognizable test file' };
  }
  const fullPath = path.resolve(consumerRoot, normalized);
  const rootPath = path.resolve(consumerRoot);
  if (fullPath !== rootPath && !fullPath.startsWith(`${rootPath}${path.sep}`)) {
    return { repositoryVerified: false, reason: 'test file is outside repository' };
  }
  if (!fileExists(fullPath)) {
    return { repositoryVerified: false, reason: 'test file not found' };
  }
  try {
    const content = fs.readFileSync(fullPath, 'utf8');
    const scenarioFound = new RegExp(`\\b${escapeRegExp(scenarioId)}\\b`, 'i').test(content);
    const testNameFound = new RegExp(escapeRegExp(testName), 'i').test(content);
    if (!scenarioFound) {
      return { repositoryVerified: false, reason: 'planned scenario ID not found in test file' };
    }
    if (!testNameFound) {
      return { repositoryVerified: false, reason: 'test name not found in test file' };
    }
    return { repositoryVerified: true, reason: 'test file, scenario, and test name found' };
  } catch {
    return { repositoryVerified: false, reason: 'unable to read test file' };
  }
}

function normalizeAcId(value) {
  if (!value) return null;
  const m = String(value).trim().match(AC_ID_RE);
  return m ? `AC${m[1]}` : null;
}

function extractAcIdFromText(text) {
  if (!text) return null;
  const m = String(text).match(/\bAC(\d+)\b/i);
  return m ? `AC${m[1]}` : null;
}

export function parseMatrixRows(planText = '') {
  const rows = [];
  const section = planText.split('## Verification matrix')[1]?.split('\n## ')[0] || '';
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (!cells.length) continue;
    const acCell = cells[0];
    const acId = extractAcIdFromText(acCell) || normalizeAcId(acCell);
    if (!acId && !acCell.startsWith('AC')) continue;
    rows.push({ acId: acId || extractAcIdFromText(acCell), acCell, row: line });
  }
  return rows;
}

function extractScenarioId(text = '') {
  const m = String(text).match(/\b(AC\d+-[TEM]\d+)\b/i);
  return m ? m[1].toUpperCase() : null;
}

function parseScenarioBullets(planText, sectionHeader) {
  const section = planText.split(sectionHeader)[1]?.split('\n### ')[0]?.split('\n## ')[0] || '';
  const scenarios = [];
  for (const line of section.split('\n')) {
    const bullet = line.match(/^\s*-\s+(.+)/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (text.startsWith('_(')) continue;
    const scenarioId = extractScenarioId(text);
    const acId = extractAcIdFromText(text);
    scenarios.push({ acId, scenarioId, description: text, raw: line });
  }
  return scenarios;
}

export function parseTestScenarios(planText = '') {
  return parseScenariosFromPlan(planText).filter((s) => s.type !== 'regression');
}

export function parseTestImplementation(planText = '') {
  const section = planText.split('## Test Implementation')[1]?.split('\n## ')[0] || '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 2) continue;
    if (/^type$/i.test(cells[0]) || /^ac$/i.test(cells[0])) continue;
    const hasAcColumn = cells.length >= 4 && normalizeAcId(cells[0]);
    const acId = hasAcColumn
      ? normalizeAcId(cells[0])
      : extractAcIdFromText(cells.join(' '));
    const scenarioCell = hasAcColumn ? cells[1] : cells[0];
    const scenarioId = extractScenarioId(scenarioCell);
    const legacyType = hasAcColumn ? cells[1] : cells[0];
    const file = hasAcColumn ? cells[2] : cells[1];
    const testName = hasAcColumn ? cells[3] : cells[2] || cells[1];
    rows.push({
      acId,
      scenarioId,
      type: scenarioId
        ? scenarioId.includes('-T')
          ? 'unit'
          : scenarioId.includes('-E')
            ? 'e2e'
            : 'manual'
        : legacyType,
      file,
      testName,
      raw: line,
    });
  }
  return rows;
}

export function parseScenarioCoverage(evidenceText = '') {
  const section = evidenceText.split('## Scenario coverage')[1]?.split('\n## ')[0] || '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    if (/^ac$/i.test(cells[0]) || /^scenario$/i.test(cells[0])) continue;
    const hasAcColumn = normalizeAcId(cells[0]);
    rows.push({
      acId: hasAcColumn ? normalizeAcId(cells[0]) : extractAcIdFromText(cells.join(' ')),
      scenarioId: hasAcColumn ? cells[1] : cells[0],
      runId: hasAcColumn && cells.length >= 4 ? cells[2] : null,
      executed: hasAcColumn ? cells[3] : cells[2],
      status: hasAcColumn ? cells[4] : cells[3],
      timestamp: hasAcColumn ? cells[5] : cells[4],
      isRegression: /regression/i.test(line),
      raw: line,
    });
  }
  return rows;
}

export function parseRegressionExecutionEvidence(evidenceText = '') {
  const section =
    evidenceText.split('## Regression execution evidence')[1]?.split('\n## ')[0] || '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    if (/^reg id$/i.test(cells[0])) continue;
    const regId = cells[0]?.match(/^REG-\d{3}$/i)?.[0]?.toUpperCase();
    if (!regId) continue;
    rows.push({
      regId,
      testReference: cells[1] || '',
      runId: cells[2] || '',
      executed: cells[1] || '',
      status: cells[3] || '',
      evidence: cells[4] || '',
      raw: line,
    });
  }
  return rows;
}

export function parseManualResults(evidenceText = '') {
  const section = evidenceText.split('## Manual check results')[1]?.split('\n## ')[0] || '';
  const manualSection = evidenceText.split('## Manual checks')[1]?.split('\n## ')[0] || '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    if (/^#$/i.test(cells[0]) || /^ac$/i.test(cells[0])) continue;
    const hasAcColumn = normalizeAcId(cells[0]);
    const hasRunColumn = Boolean(hasAcColumn && cells.length >= 6);
    rows.push({
      number: hasAcColumn ? cells[0] : cells[0],
      acId: hasAcColumn ? normalizeAcId(cells[0]) : extractAcIdFromText(cells.join(' ')),
      scenarioId: extractScenarioId(hasAcColumn ? cells[1] : cells[1]),
      scenario: hasAcColumn ? cells[1] : cells[1],
      runId: hasRunColumn ? cells[2] : null,
      result: hasRunColumn ? cells[3] : cells[2],
      notes: hasRunColumn ? cells[4] || '' : cells[3] || '',
      timestamp: hasRunColumn ? cells[5] || '' : '',
    });
  }
  for (const line of manualSection.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    if (/^ac$/i.test(cells[0])) continue;
    const acId = normalizeAcId(cells[0]);
    if (!acId) continue;
    rows.push({
      number: acId,
      acId,
      scenarioId: extractScenarioId(cells[1]),
      scenario: cells[1],
      result: cells[2],
      notes: cells[3] || '',
    });
  }
  return { results: rows, planSection: manualSection };
}

export function parseImplementationReferences(reviewText = '') {
  const section =
    reviewText.split('## Implementation references')[1]?.split('\n## ')[0] || '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line
      .split('|')
      .map((c) => c.trim())
      .filter(Boolean);
    if (cells.length < 3) continue;
    if (/^ac$/i.test(cells[0])) continue;
    const acId = normalizeAcId(cells[0]) || extractAcIdFromText(cells[0]);
    rows.push({
      acId,
      file: cells[1],
      symbol: cells[2],
      description: cells[3] || '',
    });
  }
  return rows;
}

function findByAcId(items, acId) {
  return items.filter((i) => i.acId === acId);
}

function isGenericScenario(text = '') {
  const stripped = String(text).replace(/\bAC\d+-[TEM]\d+:\s*/i, '').trim();
  return GENERIC_SCENARIO_RE.test(stripped) || GENERIC_SCENARIO_RE.test(text.trim());
}

export function deriveNotRequired(acId, strategy, planText, matrixRow) {
  const reasons = [];
  let unitRequired = strategy.unitRequired;
  let e2eRequired = strategy.e2eRequired;
  const manualRequired = strategy.manualRequired;

  const unitCell = matrixRow?.row?.split('|')[6]?.trim() || '';
  const e2eCell = matrixRow?.row?.split('|')[7]?.trim() || '';
  if (unitRequired && /N\/A/i.test(unitCell)) {
    unitRequired = false;
    reasons.push('Matrix marks unit N/A for capability');
  }
  if (e2eRequired && /N\/A/i.test(e2eCell)) {
    e2eRequired = false;
    reasons.push('Matrix marks e2e N/A for capability');
  }

  const automatedRequired = unitRequired || e2eRequired;
  if (!automatedRequired) {
    reasons.push('Test Strategy: automated tests Not Required');
  }

  return {
    unitRequired,
    e2eRequired,
    automatedRequired,
    manualRequired,
    notRequiredReason: reasons.length ? reasons.join('; ') : null,
  };
}

function resolveExecutionState({
  acId,
  strategy,
  scenarios,
  testImpls,
  coverageRows,
  manualResults,
  currentRunId,
  evidenceRunId,
  matrixRow,
  consumerRoot,
}) {
  const { unitRequired, e2eRequired, manualRequired, automatedRequired } = deriveNotRequired(
    acId,
    strategy,
    '',
    matrixRow
  );
  const unitScenarios = scenariosForAc(scenarios, acId, 'T');
  const e2eScenarios = scenariosForAc(scenarios, acId, 'E');
  const manualScenarios = scenariosForAc(scenarios, acId, 'M');
  const acCoverage = coverageRows.filter((r) => r.acId === acId);

  const currentCoverage = acCoverage.filter((r) =>
    isCurrentRunEvidence(
      { runId: r.runId || evidenceRunId, evidenceRunId: r.runId || evidenceRunId },
      currentRunId
    )
  );

  const staleCoverage = acCoverage.filter(
    (r) =>
      r.runId &&
      currentRunId &&
      r.runId !== currentRunId &&
      /^pass(?:ed)?$/i.test(String(r.status || '').trim())
  );

  const failedRow = currentCoverage.find((r) => /^fail(?:ed)?$/i.test(String(r.status || '').trim()));

  if (failedRow) return { executionState: VERIFICATION_STATE.FAIL, staleCoverage: staleCoverage.length > 0 };

  const automatedScenarios = [...unitScenarios, ...e2eScenarios];
  if (automatedRequired && automatedScenarios.length) {
    const missingImpl = automatedScenarios.some(
      (s) => {
        const impl = testImpls.find(
          (t) => t.acId === acId && t.scenarioId === s.scenarioId
        );
        return (
          !impl ||
          !verifyTestImplementationReference(consumerRoot, impl).repositoryVerified
        );
      }
    );
    if (missingImpl) {
      return { executionState: VERIFICATION_STATE.NOT_RUN, staleCoverage: staleCoverage.length > 0 };
    }
    const missingExec = automatedScenarios.some(
      (s) => {
        const impl = testImpls.find(
          (t) => t.acId === acId && t.scenarioId === s.scenarioId
        );
        return !currentCoverage.some(
          (r) =>
            r.scenarioId === s.scenarioId &&
            /^pass(?:ed)?$/i.test(String(r.status || '').trim()) &&
            executionMatchesImplementation(r, impl)
        );
      }
    );
    if (missingExec) {
      if (staleCoverage.length && !currentCoverage.length) {
        return { executionState: VERIFICATION_STATE.NOT_RUN, staleCoverage: true };
      }
      return { executionState: VERIFICATION_STATE.NOT_RUN, staleCoverage: staleCoverage.length > 0 };
    }
  }

  if (manualRequired && manualScenarios.length) {
    const manualPass = manualResults.results.some(
      (m) =>
        m.acId === acId &&
        /^pass/i.test(m.result) &&
        manualScenarios.some(
          (s) => s.scenarioId && (m.scenarioId === s.scenarioId || extractScenarioId(m.scenario) === s.scenarioId)
        ) &&
        m.runId &&
        isCurrentRunEvidence({ evidenceRunId, runId: m.runId }, currentRunId)
    );
    const manualCoveragePass = manualScenarios.every((s) =>
      currentCoverage.some(
        (r) => r.scenarioId === s.scenarioId && /^pass(?:ed)?$/i.test(String(r.status || '').trim())
      )
    );
    if (!manualPass && !manualCoveragePass) {
      return { executionState: VERIFICATION_STATE.NOT_RUN, staleCoverage: staleCoverage.length > 0 };
    }
  }

  if (automatedRequired && automatedScenarios.length) {
    return { executionState: VERIFICATION_STATE.PASS, staleCoverage: staleCoverage.length > 0 };
  }
  if (manualRequired) {
    return { executionState: VERIFICATION_STATE.PASS, staleCoverage: staleCoverage.length > 0 };
  }
  if (!automatedRequired && !manualRequired) {
    return { executionState: VERIFICATION_STATE.NOT_APPLICABLE, staleCoverage: staleCoverage.length > 0 };
  }
  return { executionState: VERIFICATION_STATE.NOT_RUN, staleCoverage: staleCoverage.length > 0 };
}

function acScenarioCoverageComplete(acId, strategy, scenarios, matrixRow) {
  const { unitRequired, e2eRequired, manualRequired } = deriveNotRequired(acId, strategy, '', matrixRow);
  const checks = [];
  if (unitRequired) checks.push(scenariosForAc(scenarios, acId, 'T').length > 0);
  if (e2eRequired) checks.push(scenariosForAc(scenarios, acId, 'E').length > 0);
  if (manualRequired) checks.push(scenariosForAc(scenarios, acId, 'M').length > 0);
  return checks.length === 0 || checks.every(Boolean);
}

export function mapAcceptanceCriterion(acId, requirement, ctx) {
  const {
    contractText = '',
    planText = '',
    evidenceText = '',
    reviewText = '',
    jiraNormalized = null,
    strategy = parseTestStrategy(planText),
    consumerRoot = '',
    runId = '',
  } = ctx;

  const evidenceRunId = parseEvidenceRunId(evidenceText);
  const matrixRows = parseMatrixRows(planText);
  const scenarios = parseTestScenarios(planText);
  const testImpls = parseTestImplementation(planText);
  const coverageRows = parseScenarioCoverage(evidenceText);
  const manualResults = parseManualResults(evidenceText);
  const implRefs = parseImplementationReferences(reviewText);

  const matrixRow = matrixRows.find((r) => r.acId === acId);
  const acImplRef = implRefs.find((r) => r.acId === acId);
  const repoCheck =
    acImplRef && consumerRoot
      ? verifyRepositoryReference(consumerRoot, acImplRef.file, acImplRef.symbol)
      : { referenced: false, repositoryVerified: false, reason: 'no structured implementation reference' };

  const jiraEvidence =
    jiraNormalized?.acceptance_criteria?.[parseInt(acId.replace('AC', ''), 10) - 1] ||
    jiraNormalized?.acceptance_criteria?.find((a) => a.includes(requirement.slice(0, 15))) ||
    null;

  const contractEvidence = contractText.includes(requirement.slice(0, 15))
    ? `Contract AC ${acId}: ${requirement}`
    : null;

  const matrixEvidence = matrixRow ? `Matrix row: ${matrixRow.acCell}` : null;

  const acScenarios = findByAcId(scenarios, acId).filter(
    (s) => s.scenarioId && SCENARIO_ID_RE.test(s.scenarioId) && !isGenericScenario(s.description)
  );
  const testScenarioEvidence = acScenarios.length
    ? acScenarios.map((s) => s.scenarioId).join('; ')
    : null;

  const acTestImpls = testImpls.filter((t) => t.acId === acId && t.scenarioId && t.file?.trim());
  const testImplementationEvidence = acTestImpls.length
    ? acTestImpls.map((t) => `${t.scenarioId}: ${t.file}${t.testName ? ` — ${t.testName}` : ''}`).join('; ')
    : null;

  const acCoverage = coverageRows.filter((r) => r.acId === acId);
  const currentCoverage = acCoverage.filter((r) =>
    isCurrentRunEvidence(
      { runId: r.runId || evidenceRunId, evidenceRunId: r.runId || evidenceRunId },
      runId
    )
  );
  const testExecutionEvidence = currentCoverage.length
    ? currentCoverage.map((r) => `${r.executed}: ${r.status}`).join('; ')
    : null;

  const implementationEvidence = acImplRef
    ? {
        acId,
        file: acImplRef.file,
        symbol: acImplRef.symbol,
        description: acImplRef.description,
        referenced: repoCheck.referenced,
        repositoryVerified: repoCheck.repositoryVerified,
        reason: repoCheck.reason,
      }
    : {
        acId,
        file: null,
        symbol: null,
        description: null,
        referenced: false,
        repositoryVerified: false,
        reason: 'no structured implementation reference',
      };

  const { executionState, staleCoverage } = resolveExecutionState({
    acId,
    strategy,
    scenarios,
    testImpls,
    coverageRows,
    manualResults,
    currentRunId: runId,
    evidenceRunId,
    matrixRow,
    consumerRoot,
  });

  const { unitRequired, e2eRequired, automatedRequired, manualRequired, notRequiredReason } =
    deriveNotRequired(acId, strategy, planText, matrixRow);

  let status = 'Missing';

  const hasVerifiedImpl = implementationEvidence.repositoryVerified;
  const hasScenario = acScenarioCoverageComplete(acId, strategy, scenarios, matrixRow);
  const hasTestImpl =
    !automatedRequired ||
    [...scenariosForAc(scenarios, acId, 'T'), ...scenariosForAc(scenarios, acId, 'E')].every((s) =>
      testImpls.some(
        (t) =>
          t.acId === acId &&
          t.scenarioId === s.scenarioId &&
          verifyTestImplementationReference(consumerRoot, t).repositoryVerified
      )
    );
  const executionPassed = executionState === VERIFICATION_STATE.PASS;
  const executionFailed = executionState === VERIFICATION_STATE.FAIL;
  const executionNotRequired = executionState === VERIFICATION_STATE.NOT_APPLICABLE;

  if (executionFailed) {
    status = 'Partial';
  } else if (staleCoverage && !currentCoverage.length) {
    status = 'Partial';
  } else if (
    hasVerifiedImpl &&
    hasScenario &&
    contractEvidence &&
    matrixEvidence &&
    hasTestImpl &&
    (executionPassed || executionNotRequired)
  ) {
    status = 'Implemented';
  } else if (hasVerifiedImpl || hasScenario || matrixEvidence || contractEvidence) {
    status = 'Partial';
  }

  return {
    acId,
    requirement,
    jiraEvidence: jiraEvidence ? String(jiraEvidence) : null,
    contractEvidence,
    matrixEvidence,
    testScenarioEvidence,
    testImplementationEvidence,
    testExecutionEvidence,
    implementationEvidence,
    executionState,
    notRequiredReason,
    provenance: {
      runId: evidenceRunId || runId,
      artifactSource: 'verification-evidence.md',
      staleEvidenceRejected: Boolean(staleCoverage && !currentCoverage.length),
    },
    status,
  };
}

export function buildRequirementCoverage(ctx) {
  const {
    contractText = '',
    planText = '',
    evidenceText = '',
    reviewText = '',
    jiraNormalized = null,
    strategy = parseTestStrategy(planText),
    consumerRoot = '',
    runId = '',
  } = ctx;

  const criteria = assignAcIds(extractAcceptanceCriteria(contractText));
  return criteria.map(({ acId, requirement }) =>
    mapAcceptanceCriterion(acId, requirement, {
      contractText,
      planText,
      evidenceText,
      reviewText,
      jiraNormalized,
      strategy,
      consumerRoot,
      runId,
    })
  );
}

export function summarizeCoverage(coverage) {
  const counts = { Implemented: 0, Partial: 0, Missing: 0 };
  for (const c of coverage) counts[c.status] = (counts[c.status] || 0) + 1;
  return counts;
}

export function findUnresolvedRequirements(coverage) {
  const reasons = [];
  for (const c of coverage) {
    if (c.status === 'Implemented') continue;
    const gaps = [];
    if (!c.implementationEvidence?.repositoryVerified) {
      gaps.push('implementation reference missing or not repository-verified');
    }
    if (!c.testScenarioEvidence) gaps.push('AC-linked test scenario missing');
    if (c.executionState === VERIFICATION_STATE.NOT_RUN) gaps.push('required execution not recorded for current run');
    if (c.executionState === VERIFICATION_STATE.FAIL) gaps.push('execution failed');
    if (c.provenance?.staleEvidenceRejected) gaps.push('only stale previous-run evidence found');
    if (
      c.status === 'Partial' &&
      c.testImplementationEvidence === null &&
      c.executionState === VERIFICATION_STATE.NOT_RUN
    ) {
      gaps.push('test implementation or execution evidence missing');
    }
    reasons.push(`${c.acId} (${c.requirement.slice(0, 40)}…): ${c.status} — ${gaps.join(', ') || 'insufficient evidence chain'}`);
  }
  return reasons;
}
