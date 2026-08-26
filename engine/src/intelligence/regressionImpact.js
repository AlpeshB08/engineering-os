/**
 * Regression impact, strategy, and scenario generation for /feature orchestration.
 */

import { analyzeChangeImpact } from './changeImpact.js';

export const REG_SCENARIO_ID_RE = /^REG-\d{3}$/i;

export function formatRegId(index) {
  return `REG-${String(index).padStart(3, '0')}`;
}

function classifyPathInBlast(blast, filePath) {
  for (const [kind, paths] of Object.entries(blast.affected_by_kind || {})) {
    if (paths.includes(filePath)) return kind;
  }
  return 'other';
}

export function inferFlowLabel(kind, path) {
  if (kind === 'routes') return `Route flow at \`${path}\``;
  if (kind === 'components') return `UI flow using \`${path}\``;
  if (kind === 'apis') return `API integration at \`${path}\``;
  if (kind === 'stores') return `State flow via \`${path}\``;
  if (kind === 'design_system') return `Design-system usage at \`${path}\``;
  return `Existing behavior at \`${path}\``;
}

export function computeRisk(changedPath, consumerPath, kind) {
  if (changedPath !== consumerPath && (kind === 'routes' || kind === 'design_system')) return 'high';
  if (changedPath !== consumerPath) return 'medium';
  return 'low';
}

/**
 * Build graph-based regression candidates from feature impact hits.
 */
export function buildRegressionImpact(root, featureImpact) {
  const candidates = [];
  const seen = new Set();
  const changedPaths = [
    ...new Set([
      ...(featureImpact.hits?.shared_components || []),
      ...(featureImpact.hits?.components || []),
      ...(featureImpact.hits?.routes || []),
      ...(featureImpact.hits?.modules || []),
    ]),
  ].slice(0, 12);

  for (const changedPath of changedPaths) {
    try {
      const blast = analyzeChangeImpact(root, changedPath);
      for (const consumerPath of blast.affected_files || []) {
        if (consumerPath === changedPath) continue;
        const key = `${changedPath}::${consumerPath}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const kind = classifyPathInBlast(blast, consumerPath);
        candidates.push({
          changedPath,
          consumerPath,
          consumerKind: kind,
          flow: inferFlowLabel(kind, consumerPath),
          risk: computeRisk(changedPath, consumerPath, kind),
          source: 'graph',
        });
      }
    } catch {
      // Graph/DNA unavailable for this path — fall through to keyword fallback below
    }
  }

  if (!candidates.length) {
    for (const area of featureImpact.hits?.regression_areas || []) {
      const key = `keyword::${area}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        changedPath: area,
        consumerPath: area,
        consumerKind: 'unknown',
        flow: inferFlowLabel('unknown', area),
        risk: 'medium',
        source: 'keyword',
      });
    }
  }

  if (!candidates.length && changedPaths.length) {
    for (const changedPath of changedPaths) {
      const key = `impact::${changedPath}`;
      if (seen.has(key)) continue;
      seen.add(key);
      candidates.push({
        changedPath,
        consumerPath: changedPath,
        consumerKind: 'design_system',
        flow: inferFlowLabel('design_system', changedPath),
        risk: 'medium',
        source: 'impact',
      });
    }
  }

  return {
    changedPaths,
    candidates: candidates.slice(0, 20),
    consumerCount: new Set(candidates.map((c) => c.consumerPath)).size,
  };
}

export function renderRegressionBlastRadiusSection(regressionImpact) {
  if (!regressionImpact.candidates.length) {
    return `## Regression blast radius

- (none detected — confirm manually if shared components changed)
`;
  }
  const lines = regressionImpact.candidates.map(
    (c) =>
      `- Changed \`${c.changedPath}\` → consumer \`${c.consumerPath}\` (${c.consumerKind}, ${c.risk} risk) — ${c.flow}`
  );
  return `## Regression blast radius

${lines.join('\n')}
`;
}

export function decideRegressionStrategy({ regressionImpact = {}, capabilities = {}, featureStrategy = {} }) {
  const signals = featureStrategy.signals || {};
  const candidateCount = regressionImpact.candidates?.length || 0;
  const sharedImpact =
    (signals.shared_component_changes || 0) > 0 ||
    regressionImpact.candidates?.some((c) => c.changedPath !== c.consumerPath);
  const highRisk = regressionImpact.candidates?.some((c) => c.risk === 'high') || false;

  const hasUnitCap = Boolean(capabilities['unit-tests']?.present);
  const hasE2eCap = Boolean(capabilities['e2e-tests']?.present);

  if (candidateCount === 0 && !sharedImpact && (signals.regression_impact || 0) === 0) {
    return {
      required: false,
      automated: {
        required: false,
        reason: 'No shared-component or downstream consumer regression risk detected.',
      },
      manual: {
        required: false,
        reason: 'Isolated change with no graph-derived regression candidates.',
      },
      label: 'Not Required',
    };
  }

  const lowRiskOnly =
    candidateCount >= 1 &&
    candidateCount <= 1 &&
    !sharedImpact &&
    !highRisk &&
    !signals.high_risk?.length;

  if (lowRiskOnly) {
    return {
      required: true,
      automated: { required: false, reason: 'Limited blast radius; manual regression sufficient.' },
      manual: { required: true, reason: 'Verify existing behavior in affected area.' },
      label: 'Manual only',
    };
  }

  return {
    required: true,
    automated: {
      required: hasE2eCap || hasUnitCap,
      reason: hasE2eCap
        ? 'Shared or multi-consumer impact — automated regression recommended where capability exists.'
        : hasUnitCap
          ? 'Automated unit regression available for affected modules.'
          : 'Automated regression recommended but capability absent — expand manual QA.',
    },
    manual: {
      required: true,
      reason: 'Existing consumer flows require targeted manual regression verification.',
    },
    label: hasE2eCap || hasUnitCap ? 'Automated + Manual' : 'Manual only',
  };
}

function fallbackRegressionCandidates(regressionImpact = {}) {
  const fromHits = [
    ...(regressionImpact.changedPaths || []),
    ...(regressionImpact.hits?.shared_components || []),
    ...(regressionImpact.hits?.components || []),
    ...(regressionImpact.hits?.routes || []),
    ...(regressionImpact.hits?.regression_areas || []),
  ].filter((p) => p && !/none detected/i.test(p));
  const unique = [...new Set(fromHits)];
  if (unique.length) {
    return unique.slice(0, 5).map((changedPath) => ({
      changedPath,
      consumerPath: changedPath,
      consumerKind: 'other',
      flow: inferFlowLabel('other', changedPath),
      risk: 'medium',
      source: 'impact-fallback',
    }));
  }
  return [
    {
      changedPath: 'existing related behavior',
      consumerPath: 'affected feature area',
      consumerKind: 'other',
      flow: 'Existing related behavior in the impacted feature area',
      risk: 'medium',
      source: 'related-behavior',
    },
  ];
}

export function generateRegressionScenarios({ regressionImpact = {}, regressionStrategy = {} }) {
  if (!regressionStrategy.required) return [];
  const candidates = (regressionImpact.candidates || []).length
    ? regressionImpact.candidates
    : fallbackRegressionCandidates(regressionImpact);
  const scenarios = [];
  let index = 1;
  for (const candidate of candidates) {
    const regId = formatRegId(index++);
    scenarios.push({
      regId,
      changedPath: candidate.changedPath,
      consumerPath: candidate.consumerPath,
      consumerKind: candidate.consumerKind,
      flow: candidate.flow,
      expectedBehavior: `Existing behavior unchanged after change to \`${candidate.changedPath}\``,
      priority: candidate.risk,
      riskClassification: candidate.risk,
      classification: candidate.consumerKind || 'other',
      automated: regressionStrategy.automated?.required && candidate.risk !== 'low',
      manual: regressionStrategy.manual?.required !== false,
      description: `${regId}: ${candidate.flow} — verify existing behavior unchanged (${candidate.risk} risk)`,
    });
  }
  return scenarios;
}

export function generateQaRegressionScope({ regressionScenarios = [], regressionStrategy = {} }) {
  const manualRequired =
    regressionStrategy.manual?.required ?? regressionStrategy.manualRequired ?? false;
  if (!regressionStrategy.required || !manualRequired) return [];
  const items = [];
  const seen = new Set();
  for (const s of regressionScenarios) {
    const flow =
      s.flow ||
      (s.consumerPath
        ? inferFlowLabel(s.consumerKind || 'other', s.consumerPath)
        : 'Existing behavior');
    const text = `${flow} (${s.regId})`;
    if (seen.has(text)) continue;
    seen.add(text);
    items.push({ regId: s.regId, label: text, flow });
  }
  return items;
}

export function renderRegressionStrategySection(strategy) {
  const req = (d) => (d.required ? 'Required' : 'Not Required');
  return `## Regression Strategy

Strategy: ${strategy.label || 'Not Required'}

| Strategy | Required | Reason |
|----------|----------|--------|
| Automated Regression | ${req(strategy.automated)} | ${strategy.automated.reason} |
| Manual QA Regression | ${req(strategy.manual)} | ${strategy.manual.reason} |

Automated Regression: ${req(strategy.automated)}
Manual QA Regression: ${req(strategy.manual)}
`;
}

export function renderRegressionScenariosSection(scenarios, { required = false } = {}) {
  if (!scenarios.length) {
    return required
      ? `## Regression Scenarios

- _(regression required — populate REG-### scenarios during planning)_
`
      : `## Regression Scenarios

- _(not required)_
`;
  }
  const lines = scenarios.map(
    (s) =>
      `- ${s.regId}: changed \`${s.changedPath}\` → consumer \`${s.consumerPath}\` — ${s.expectedBehavior} [${s.priority} risk, classification: ${s.classification || s.consumerKind || 'other'}${s.automated ? ', automated' : ''}${s.manual ? ', manual QA' : ''}]`
  );
  return `## Regression Scenarios

${lines.join('\n')}
`;
}

export function renderQaRegressionScopeSection(scopeItems) {
  if (!scopeItems.length) {
    return `## QA Regression Scope

- _(not required)_
`;
  }
  return `## QA Regression Scope

${scopeItems.map((i) => `- ${i.label}`).join('\n')}
`;
}

export function renderRegressionTestImplementationPlaceholder() {
  return `## Regression Test Implementation

| REG ID | Test File / Reference | Test Type | Status |
|--------|----------------------|-----------|--------|
| | | | |
`;
}

export function parseRegressionStrategyFromPlan(planText = '') {
  const automated = /Automated Regression:\s*(Required|Not Required)/i.exec(planText);
  const manual = /Manual QA Regression:\s*(Required|Not Required)/i.exec(planText);
  const labelMatch = /## Regression Strategy[\s\S]*?Strategy:\s*(.+)/i.exec(planText);
  const automatedRequired = automated?.[1]?.toLowerCase() === 'required';
  const manualRequired = manual?.[1]?.toLowerCase() === 'required';
  const required = automatedRequired || manualRequired || /Strategy:\s*(?!Not Required)/i.test(labelMatch?.[1] || '');
  const notRequired =
    /Strategy:\s*Not Required/i.test(planText) &&
    !automatedRequired &&
    !manualRequired;
  return {
    required: notRequired ? false : required,
    automatedRequired,
    manualRequired,
    label: labelMatch?.[1]?.trim() || (notRequired ? 'Not Required' : 'Required'),
    automated: {
      required: automatedRequired,
      reason: '',
    },
    manual: {
      required: manualRequired,
      reason: '',
    },
  };
}

export function parseRegressionScenariosFromPlan(planText = '') {
  const section = planText.split('## Regression Scenarios')[1]?.split('\n## ')[0] || '';
  const scenarios = [];
  for (const line of section.split('\n')) {
    const bullet = line.match(/^\s*-\s+(.+)/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (text.startsWith('_(')) continue;
    const regMatch = text.match(/\b(REG-\d{3})\b/i);
    if (!regMatch) continue;
    const regId = regMatch[1].toUpperCase();
    const changedMatch = text.match(/changed `([^`]+)`/);
    const consumerMatch = text.match(/consumer `([^`]+)`/);
    const riskMatch = text.match(/\[(high|medium|low) risk/i);
    const classificationMatch = text.match(/\bclassification:\s*([a-z0-9_-]+)/i);
    scenarios.push({
      regId,
      changedPath: changedMatch?.[1] || '',
      consumerPath: consumerMatch?.[1] || '',
      expectedBehavior: text.split('—').slice(1).join('—').trim() || text,
      priority: riskMatch?.[1] || '',
      riskClassification: riskMatch?.[1] || '',
      classification:
        classificationMatch?.[1] ||
        (consumerMatch?.[1] ? 'consumer-flow' : ''),
      automated: /automated/i.test(text),
      manual: /manual QA/i.test(text) || !/automated only/i.test(text),
      description: text,
    });
  }
  return scenarios;
}

export function parseRegressionTestImplementation(planText = '') {
  const section = planText.split('## Regression Test Implementation')[1]?.split('\n## ')[0] || '';
  const rows = [];
  for (const line of section.split('\n')) {
    if (!line.trim().startsWith('|') || line.includes('----')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const inner = cells.slice(1, cells[cells.length - 1] === '' ? -1 : undefined);
    if (inner.length < 4) continue;
    if (/^reg id$/i.test(inner[0])) continue;
    const regId = inner[0]?.match(REG_SCENARIO_ID_RE)?.[0]?.toUpperCase();
    if (!regId) continue;
    rows.push({
      regId,
      file: inner[1] || '',
      testType: inner[2] || '',
      status: inner[3] || '',
    });
  }
  return rows;
}

export function parseQaRegressionScope(planText = '') {
  const section = planText.split('## QA Regression Scope')[1]?.split('\n## ')[0] || '';
  const items = [];
  for (const line of section.split('\n')) {
    const bullet = line.match(/^\s*-\s+(.+)/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (text.startsWith('_(')) continue;
    const regMatch = text.match(/\b(REG-\d{3})\b/i);
    items.push({
      regId: regMatch ? regMatch[1].toUpperCase() : null,
      label: text,
    });
  }
  return items;
}

export function validateRegressionPlanPlanning(planText = '') {
  const issues = [];
  const strategy = parseRegressionStrategyFromPlan(planText);
  const scenarios = parseRegressionScenariosFromPlan(planText);
  const qaScope = parseQaRegressionScope(planText);

  if (!planText.includes('## Regression Strategy')) {
    issues.push('missing Regression Strategy section');
  }

  if (strategy.required) {
    if (!scenarios.length) {
      issues.push('regression required but no REG scenarios found');
    }
    for (const s of scenarios) {
      if (!REG_SCENARIO_ID_RE.test(s.regId)) {
        issues.push(`${s.regId || 'scenario'} missing valid REG-### ID`);
      }
      if (!s.riskClassification || !/^(high|medium|low)$/i.test(s.riskClassification)) {
        issues.push(`${s.regId} missing explicit risk classification`);
      }
      if (!s.classification) {
        issues.push(`${s.regId} missing regression classification`);
      }
    }
    if (strategy.manualRequired && !qaScope.length) {
      issues.push('manual QA regression required but QA Regression Scope is empty');
    }
  } else {
    if (scenarios.some((s) => !s.regId.startsWith('REG-'))) {
      issues.push('invalid regression scenario ID format');
    }
  }

  return { ok: issues.length === 0, issues, strategy, scenarios, qaScope };
}

export function applyRegressionSectionsToPlan(content, sections) {
  let result = content;
  for (const [header, body] of sections) {
    const escaped = header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const replacement = `${body.trim()}\n\n`;
    if (result.includes(header)) {
      result = result.replace(
        new RegExp(`${escaped}[\\s\\S]*?(?=\\n## |\\n# |$)`),
        replacement
      );
    } else {
      const insertBefore = result.includes('## Test Implementation')
        ? '## Test Implementation'
        : result.includes('## Automated checks')
          ? '## Automated checks'
          : result.includes('## Verification matrix')
            ? '## Verification matrix'
            : null;
      result = insertBefore
        ? result.replace(insertBefore, `${body.trim()}\n\n${insertBefore}`)
        : `${result.trimEnd()}\n\n${body.trim()}\n`;
    }
  }
  return result;
}
