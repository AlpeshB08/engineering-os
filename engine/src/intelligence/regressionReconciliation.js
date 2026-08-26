/**
 * Post-implementation regression impact reconciliation.
 */

import { loadDna } from './dna.js';
import { analyzeChangeImpact } from './changeImpact.js';
import {
  formatRegId,
  generateQaRegressionScope,
  parseRegressionScenariosFromPlan,
  REG_SCENARIO_ID_RE,
  computeRisk,
  inferFlowLabel,
} from './regressionImpact.js';
import { getImplementationChangedFiles } from '../gitChanges.js';

const HIGH_IMPACT_KINDS = new Set([
  'design_system',
  'components',
  'routes',
  'apis',
  'stores',
  'services',
  'hooks',
]);

function normalizePath(filePath = '') {
  return String(filePath).trim().replace(/^\.\//, '').split('/').join('/');
}

function pathsMatch(a = '', b = '') {
  const left = normalizePath(a);
  const right = normalizePath(b);
  return (
    left === right ||
    left.endsWith(`/${right}`) ||
    right.endsWith(`/${left}`) ||
    left.includes(right) ||
    right.includes(left)
  );
}

function candidateKey(changedPath, consumerPath) {
  return `${normalizePath(changedPath)}::${normalizePath(consumerPath)}`;
}

function classifyPathInBlast(blast, filePath) {
  for (const [kind, paths] of Object.entries(blast.affected_by_kind || {})) {
    if (paths.some((p) => pathsMatch(p, filePath))) return kind;
  }
  return 'other';
}

function classifyInventoryKind(dna, filePath) {
  for (const [kind, items] of Object.entries(dna?.inventory || {})) {
    if (items.some((i) => pathsMatch(i.path, filePath))) return kind;
  }
  return 'other';
}

export function isHighImpactChangedFile(dna, filePath) {
  const kind = classifyInventoryKind(dna, filePath);
  return HIGH_IMPACT_KINDS.has(kind);
}

export function buildActualRegressionImpact(root, changedFiles = []) {
  const dna = loadDna(root);
  if (!dna || !changedFiles.length) {
    return { changedFiles: [], highImpactFiles: [], candidates: [] };
  }

  const highImpactFiles = [
    ...new Set(changedFiles.filter((f) => isHighImpactChangedFile(dna, f))),
  ].slice(0, 12);

  const candidates = [];
  const seen = new Set();

  for (const changedPath of highImpactFiles) {
    try {
      const blast = analyzeChangeImpact(root, changedPath);
      for (const consumerPath of blast.affected_files || []) {
        if (pathsMatch(consumerPath, changedPath)) continue;
        const key = candidateKey(changedPath, consumerPath);
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = classifyPathInBlast(blast, consumerPath);
        const risk = computeRisk(changedPath, consumerPath, kind);
        if (risk === 'low') continue;
        candidates.push({
          changedPath: normalizePath(changedPath),
          consumerPath: normalizePath(consumerPath),
          consumerKind: kind,
          flow: inferFlowLabel(kind, consumerPath),
          risk,
          source: 'graph',
        });
      }
    } catch {
      // DNA/graph unavailable for path
    }
  }

  return { changedFiles, highImpactFiles, candidates };
}

function maxRegIndex(scenarios = []) {
  let max = 0;
  for (const s of scenarios) {
    const m = String(s.regId || '').match(REG_SCENARIO_ID_RE);
    if (m) max = Math.max(max, parseInt(m[0].replace('REG-', ''), 10));
  }
  return max;
}

function scenarioFromCandidate(candidate, regId, regressionStrategy) {
  return {
    regId,
    changedPath: candidate.changedPath,
    consumerPath: candidate.consumerPath,
    consumerKind: candidate.consumerKind,
    flow: candidate.flow,
    expectedBehavior: `Existing behavior unchanged after change to \`${candidate.changedPath}\``,
    priority: candidate.risk,
    riskClassification: candidate.risk,
    classification: candidate.consumerKind || 'consumer-flow',
    automated: regressionStrategy.automatedRequired && candidate.risk !== 'low',
    manual: regressionStrategy.manualRequired !== false,
    description: `${regId}: ${candidate.flow} — verify existing behavior unchanged (${candidate.risk} risk)`,
    reconciliationStatus: 'newly_discovered',
  };
}

function isMeaningfulNewCandidate(candidate, changedFiles, highImpactFiles) {
  if (!highImpactFiles.some((f) => pathsMatch(f, candidate.changedPath))) return false;
  if (candidate.risk === 'low') return false;
  if (pathsMatch(candidate.changedPath, candidate.consumerPath)) return false;
  return changedFiles.some((f) => pathsMatch(f, candidate.changedPath));
}

export function reconcileRegressionImpact({
  root,
  plannedScenarios = [],
  changedFiles = [],
  regressionStrategy = {},
  scopeStrategy = 'full_regression_scope',
  evidenceBackedRegIds = [],
  preservePlannedWhenChangesUnknown = false,
}) {
  const actual = buildActualRegressionImpact(root, changedFiles);
  const focused = scopeStrategy === 'focused_high_risk_scope';
  const scopedPlanned = focused
    ? plannedScenarios.filter((s) => (s.priority || s.riskClassification) === 'high')
    : plannedScenarios;
  const scopedCandidates = focused
    ? actual.candidates.filter((c) => c.risk === 'high')
    : actual.candidates;
  const plannedByKey = new Map(
    scopedPlanned.map((s) => [candidateKey(s.changedPath, s.consumerPath), s])
  );
  const actualByKey = new Map(
    scopedCandidates.map((c) => [candidateKey(c.changedPath, c.consumerPath), c])
  );

  const rows = [];
  const reconciledScenarios = [];
  const newlyDiscovered = [];
  const classificationChanged = [];
  const noLongerRelevant = [];

  const evidenceBacked = new Set(
    (evidenceBackedRegIds || []).map((regId) => String(regId || '').toUpperCase())
  );

  for (const planned of scopedPlanned) {
    const key = candidateKey(planned.changedPath, planned.consumerPath);
    const actualMatch = actualByKey.get(key);
    const stillRelevant = Boolean(actualMatch);
    const hasCurrentRunEvidence = evidenceBacked.has(String(planned.regId || '').toUpperCase());
    const preserveWhenUnknown =
      preservePlannedWhenChangesUnknown && !changedFiles.length && !stillRelevant;

    if (stillRelevant || hasCurrentRunEvidence || preserveWhenUnknown) {
      const changedClassification =
        Boolean(actualMatch?.risk) &&
        Boolean(planned.priority) &&
        planned.priority !== actualMatch.risk;
      rows.push({
        change: planned.changedPath,
        consumer: planned.consumerPath,
        planned: 'Yes',
        isNew: 'No',
        risk: actualMatch?.risk || planned.priority || '',
        regId: planned.regId,
        status: hasCurrentRunEvidence
          ? 'evidence_verified'
          : preserveWhenUnknown
            ? 'planned_preserved'
            : changedClassification
              ? 'classification_changed'
              : 'planned_relevant',
      });
      const reconciled = {
        ...planned,
        priority: actualMatch?.risk || planned.priority,
        riskClassification: actualMatch?.risk || planned.riskClassification,
        classification: planned.classification || actualMatch?.consumerKind || 'consumer-flow',
        flow:
          planned.flow ||
          actualMatch?.flow ||
          inferFlowLabel(actualMatch?.consumerKind || 'other', planned.consumerPath),
        reconciliationStatus: hasCurrentRunEvidence
          ? 'evidence_verified'
          : preserveWhenUnknown
            ? 'planned_preserved'
            : changedClassification
              ? 'classification_changed'
              : 'planned_relevant',
      };
      reconciledScenarios.push(reconciled);
      if (changedClassification) classificationChanged.push(reconciled);
    } else {
      rows.push({
        change: planned.changedPath,
        consumer: planned.consumerPath,
        planned: 'Yes',
        isNew: 'No',
        risk: planned.priority || 'medium',
        regId: planned.regId,
        status: 'no_longer_relevant',
      });
      noLongerRelevant.push(planned);
    }
  }

  let nextIndex = maxRegIndex(plannedScenarios) + 1;
  const sortedNew = [...scopedCandidates].sort((a, b) =>
    candidateKey(a.changedPath, a.consumerPath).localeCompare(
      candidateKey(b.changedPath, b.consumerPath)
    )
  );

  for (const candidate of sortedNew) {
    const key = candidateKey(candidate.changedPath, candidate.consumerPath);
    if (plannedByKey.has(key)) continue;
    if (!isMeaningfulNewCandidate(candidate, changedFiles, actual.highImpactFiles)) continue;

    const regId = formatRegId(nextIndex++);
    const scenario = scenarioFromCandidate(candidate, regId, regressionStrategy);
    rows.push({
      change: scenario.changedPath,
      consumer: scenario.consumerPath,
      planned: 'No',
      isNew: 'Yes',
      risk: scenario.priority,
      regId: scenario.regId,
      status: 'newly_discovered',
    });
    reconciledScenarios.push(scenario);
    newlyDiscovered.push(scenario);
  }

  const qaScope = generateQaRegressionScope({
    regressionScenarios: reconciledScenarios,
    regressionStrategy,
  });

  return {
    plannedScenarios,
    actualImpact: actual,
    changedFiles,
    rows,
    reconciledScenarios,
    newlyDiscovered,
    classificationChanged,
    noLongerRelevant,
    qaScope,
    reconciledRegIds: reconciledScenarios.map((s) => s.regId),
    scopeStrategy,
  };
}

export function renderPostImplementationRegressionTable(rows = []) {
  if (!rows.length) {
    return `## Post-Implementation Regression Impact

| Change | Consumer | Planned | New | Risk | REG ID | Status |
|--------|----------|---------|-----|------|--------|--------|
| _(none — no meaningful post-implementation regression delta)_ | | | | | | |
`;
  }
  const body = rows
    .map(
      (r) =>
        `| \`${r.change}\` | \`${r.consumer}\` | ${r.planned} | ${r.isNew} | ${r.risk} | ${r.regId} | ${r.status} |`
    )
    .join('\n');
  return `## Post-Implementation Regression Impact

| Change | Consumer | Planned | New | Risk | REG ID | Status |
|--------|----------|---------|-----|------|--------|--------|
${body}
`;
}

export function renderReconciledRegressionScopeSection(reconciledScenarios = []) {
  if (!reconciledScenarios.length) {
    return `## Reconciled Regression Scope

- _(none required)_
`;
  }
  const lines = reconciledScenarios.map((s) => {
    const flow =
      s.flow ||
      (s.consumerPath
        ? inferFlowLabel(s.consumerKind || 'other', s.consumerPath)
        : 'Existing behavior');
    return `- ${flow} (${s.regId})`;
  });
  return `## Reconciled Regression Scope

${lines.join('\n')}
`;
}

export function renderReconciledQaRegressionScopeSection(qaScope = []) {
  if (!qaScope.length) {
    return `## QA Regression Scope

- _(not required)_
`;
  }
  return `## QA Regression Scope

${qaScope.map((i) => `- Verify ${i.label.replace(/\([^)]+\)\s*$/, '').trim()} (${i.regId})`).join('\n')}
`;
}

export function renderReconciledRegressionScenariosSection(scenarios = []) {
  if (!scenarios.length) {
    return `## Regression Scenarios

- _(not required)_
`;
  }
  const lines = scenarios.map(
    (s) =>
      `- ${s.regId}: changed \`${s.changedPath}\` → consumer \`${s.consumerPath}\` — ${s.expectedBehavior} [${s.priority} risk${s.automated ? ', automated' : ''}${s.manual ? ', manual QA' : ''}]`
  );
  return `## Regression Scenarios

${lines.join('\n')}
`;
}

export function parseReconciledRegIdsFromEvidence(evidenceText = '') {
  const marker = evidenceText.match(/<!--\s*EOS_RECONCILED_REG_IDS:\s*([^>]+)\s*-->/i);
  if (!marker) return null;
  return marker[1]
    .split(',')
    .map((id) => id.trim().toUpperCase())
    .filter((id) => REG_SCENARIO_ID_RE.test(id));
}

export function parseChangedRegIdsFromEvidence(evidenceText = '') {
  const marker = evidenceText.match(/<!--\s*EOS_CHANGED_REG_IDS:\s*([^>]*)-->/i);
  if (!marker) return [];
  return marker[1]
    .split(',')
    .map((id) => id.trim().toUpperCase())
    .filter((id) => REG_SCENARIO_ID_RE.test(id));
}

export function parsePostImplementationRegressionRows(evidenceText = '') {
  const section =
    evidenceText.split('## Post-Implementation Regression Impact')[1]?.split('\n## ')[0] || '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const inner = cells.slice(1, cells[cells.length - 1] === '' ? -1 : undefined);
    if (inner.length < 7) continue;
    if (/^change$/i.test(inner[0])) continue;
    if (inner[0].startsWith('_(')) continue;
    rows.push({
      change: inner[0].replace(/`/g, ''),
      consumer: inner[1].replace(/`/g, ''),
      planned: inner[2],
      isNew: inner[3],
      risk: inner[4],
      regId: inner[5],
      status: inner[6],
    });
  }
  return rows;
}

export function applyReconciliationToEvidence(content, reconciliation) {
  const regMarker = reconciliation.reconciledRegIds?.length
    ? `<!-- EOS_RECONCILED_REG_IDS: ${reconciliation.reconciledRegIds.join(',')} -->`
    : '<!-- EOS_RECONCILED_REG_IDS: -->';
  const changedMarker = reconciliation.classificationChanged?.length
    ? `<!-- EOS_CHANGED_REG_IDS: ${reconciliation.classificationChanged.map((s) => s.regId).join(',')} -->`
    : '<!-- EOS_CHANGED_REG_IDS: -->';
  const sections = [
    `## Post-Implementation Regression Reconciliation\n\n${regMarker}\n${changedMarker}\n\nScope strategy: ${reconciliation.scopeStrategy || 'full_regression_scope'}\nChanged files analyzed: ${reconciliation.changedFiles.length}\nHigh-impact changed files: ${reconciliation.actualImpact.highImpactFiles.length}\nNewly discovered scenarios: ${reconciliation.newlyDiscovered.length}\nClassification changes: ${reconciliation.classificationChanged?.length || 0}\n`,
    renderPostImplementationRegressionTable(reconciliation.rows),
    renderReconciledRegressionScopeSection(reconciliation.reconciledScenarios),
  ].join('\n');

  if (content.includes('## Post-Implementation Regression Reconciliation')) {
    return content.replace(
      /## Post-Implementation Regression Reconciliation[\s\S]*?(?=\n## Scenario coverage|\n## Regression execution evidence|\n## Manual check|\n## Failures|\n## Conclusion)/,
      `${sections.trim()}\n\n`
    );
  }
  const insertBefore = content.includes('## Regression execution evidence')
    ? '## Regression execution evidence'
    : content.includes('## Scenario coverage')
      ? '## Scenario coverage'
      : '## Conclusion';
  return content.replace(insertBefore, `${sections.trim()}\n\n${insertBefore}`);
}

export function applyReconciliationToPlan(content, reconciliation, regressionStrategy) {
  let result = applySectionReplace(
    content,
    '## Regression Scenarios',
    renderReconciledRegressionScenariosSection(reconciliation.reconciledScenarios)
  );
  if (regressionStrategy.manualRequired) {
    result = applySectionReplace(
      result,
      '## QA Regression Scope',
      renderReconciledQaRegressionScopeSection(reconciliation.qaScope)
    );
  }
  return result;
}

function applySectionReplace(content, header, body) {
  if (content.includes(header)) {
    return content.replace(
      new RegExp(`${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n## )`),
      `${body.trim()}\n\n`
    );
  }
  return content;
}

function inferChangedFilesFromSession(run = {}) {
  const session = run.feature_session || {};
  const fromCases = (session.regression?.cases || [])
    .flatMap((scenario) => [scenario.changedPath, scenario.consumerPath])
    .filter(Boolean);
  const fromImpl = (session.implementation?.tests_created || []).filter(
    (filePath) => filePath && !/\.(test|spec)\.[cm]?[jt]sx?$/i.test(filePath)
  );
  return [...new Set([...fromCases, ...fromImpl].map(normalizePath))].filter(Boolean);
}

export function runPostImplementationRegressionReconciliation({
  root,
  planText = '',
  run = {},
  regressionStrategy = {},
  changedFilesOverride = null,
}) {
  const plannedScenarios = parseRegressionScenariosFromPlan(planText);
  const changed =
    changedFilesOverride != null
      ? { files: changedFilesOverride, source: 'override' }
      : getImplementationChangedFiles(root, run);
  let changedFiles = changed.files || [];
  const preservePlannedWhenChangesUnknown =
    changedFilesOverride == null && (changed.source === 'none' || Boolean(changed.reason));
  if (!changedFiles.length) {
    changedFiles = inferChangedFilesFromSession(run);
  }
  const evidenceBackedRegIds = (run.feature_session?.regression?.case_results || [])
    .filter((result) => result.status === 'Passed')
    .map((result) => result.regId)
    .filter(Boolean);

  const reconciliation = reconcileRegressionImpact({
    root,
    plannedScenarios,
    changedFiles,
    regressionStrategy,
    scopeStrategy:
      run.flags?.regression_scope_strategy ||
      run.workflow_decisions?.['regression-scope']?.selectedOption ||
      'full_regression_scope',
    evidenceBackedRegIds,
    preservePlannedWhenChangesUnknown,
  });

  if (!regressionStrategy.required) {
    return {
      ...reconciliation,
      reconciledScenarios: [],
      reconciledRegIds: [],
      newlyDiscovered: [],
      qaScope: [],
      changedFilesSource: changed.source,
    };
  }

  return {
    ...reconciliation,
    changedFilesSource: changed.source,
  };
}
