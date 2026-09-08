/**
 * Test Strategy Decision Engine — risk-based unit/e2e/manual decisions.
 */

import { extractAcceptanceCriteria } from './verificationMatrix.js';
import { validateRegressionPlanPlanning } from './regressionImpact.js';
import { computeRiskAutomationNeeds } from './testCapabilities.js';

const HIGH_RISK_KEYWORDS = [
  'payment',
  'auth',
  'authentication',
  'authorization',
  'permission',
  'invite',
  'invitation',
  'membership',
  'delete',
  'financial',
  'security',
  'password',
  'token',
  'role',
  'guardian',
  'export',
];

const MULTI_STEP_KEYWORDS = [
  'workflow',
  'multi-step',
  'multistep',
  'onboarding',
  'checkout',
  'wizard',
  'journey',
];

// Presentation-only vocabulary. Terminology/label/wording changes are the most common
// low-risk change in real projects and were previously unrepresented here, which pushed
// pure copy work into the "E2E required" branch.
const LOW_RISK_KEYWORDS = [
  'copy',
  'text',
  'typo',
  'visual',
  'layout',
  'styling',
  'color',
  'spacing',
  'label',
  'labels',
  'terminology',
  'wording',
  'microcopy',
  'rename',
  'renaming',
  'naming',
  'placeholder',
  'tooltip',
  'heading',
  'translation',
  'i18n',
  'localization',
];

export const SCENARIO_ID_RE = /^AC\d+-[TEM]\d+$/i;

export function formatScenarioId(acId, index, prefix) {
  return `${acId}-${prefix}${String(index).padStart(2, '0')}`;
}

export function formatScenarioBullet({ acId, scenarioId, description }) {
  return `${scenarioId}: ${description}`;
}

function extractAcItemsWithIds(contractText) {
  return extractAcceptanceCriteria(contractText).map((text, idx) => ({
    acId: `AC${idx + 1}`,
    text,
  }));
}

function parseStrategyRequirement(planText, label) {
  const match = new RegExp(`${label}:\\s*([^\\n]+)`, 'i').exec(planText);
  if (!match) return { required: false, pendingApproval: false };
  const value = match[1].trim().toLowerCase();
  const pendingApproval = value.startsWith('required (pending setup approval)');
  return {
    required: value === 'required' || pendingApproval,
    pendingApproval,
  };
}

export function parseStrategyFromPlan(planText = '') {
  const unit = parseStrategyRequirement(planText, 'Unit Tests');
  const e2e = parseStrategyRequirement(planText, 'E2E Tests');
  const manual = parseStrategyRequirement(planText, 'Manual QA');
  return {
    unitRequired: unit.required,
    e2eRequired: e2e.required,
    e2ePendingApproval: e2e.pendingApproval,
    unitPendingApproval: unit.pendingApproval,
    manualRequired: manual.required,
  };
}

function parseScenarioSection(planText, sectionHeader) {
  const section = planText.split(sectionHeader)[1]?.split('\n### ')[0]?.split('\n## ')[0] || '';
  const scenarios = [];
  for (const line of section.split('\n')) {
    const bullet = line.match(/^\s*-\s+(.+)/);
    if (!bullet) continue;
    const text = bullet[1].trim();
    if (text.startsWith('_(')) continue;
    const scenarioIdMatch = text.match(/\b(AC\d+-[TEM]\d+)\b/i);
    const acIdMatch = text.match(/\b(AC\d+)\b/i);
    scenarios.push({
      acId: acIdMatch ? acIdMatch[1].toUpperCase() : null,
      scenarioId: scenarioIdMatch ? scenarioIdMatch[1].toUpperCase() : null,
      description: text,
      type: sectionHeader.includes('Unit')
        ? 'unit'
        : sectionHeader.includes('E2E')
          ? 'e2e'
          : sectionHeader.includes('Manual')
            ? 'manual'
            : 'regression',
    });
  }
  return scenarios;
}

export function parseScenariosFromPlan(planText = '') {
  return [
    ...parseScenarioSection(planText, '### Unit test scenarios'),
    ...parseScenarioSection(planText, '### E2E test scenarios'),
    ...parseScenarioSection(planText, '### Manual test scenarios'),
    ...parseScenarioSection(planText, '### Regression scenarios'),
  ];
}

export function scenariosForAc(scenarios, acId, typePrefix) {
  return scenarios.filter(
    (s) =>
      s.acId === acId &&
      s.scenarioId &&
      new RegExp(`^${acId}-${typePrefix}\\d+$`, 'i').test(s.scenarioId)
  );
}

export function validateVerificationPlanTestPlanning(planText = '', contractText = '') {
  const issues = [];
  const strategy = parseStrategyFromPlan(planText);
  const acItems = extractAcItemsWithIds(contractText);
  const scenarios = parseScenariosFromPlan(planText);

  if (!planText.includes('## Test Strategy')) {
    issues.push('missing Test Strategy section');
  }
  if (!/Manual QA:\s*(Required|Not Required)/i.test(planText)) {
    issues.push('missing Manual QA strategy decision');
  }
  if (!planText.includes('## Test Scenarios')) {
    issues.push('missing Test Scenarios section');
  }

  for (const { acId } of acItems) {
    if (strategy.unitRequired && !scenariosForAc(scenarios, acId, 'T').length) {
      issues.push(`${acId} missing unit scenario (AC{n}-T##)`);
    }
    if (strategy.e2eRequired && !scenariosForAc(scenarios, acId, 'E').length) {
      issues.push(`${acId} missing e2e scenario (AC{n}-E##)`);
    }
    if (strategy.manualRequired && !scenariosForAc(scenarios, acId, 'M').length) {
      issues.push(`${acId} missing manual scenario (AC{n}-M##)`);
    }
  }

  const regression = validateRegressionPlanPlanning(planText);
  if (!regression.ok) issues.push(...regression.issues);

  return { ok: issues.length === 0, issues, strategy, acCount: acItems.length, regression };
}

export function parseImpactSignals(impactText = '') {
  return {
    affected_routes_count: countSectionPaths(impactText, '## Routes / screens'),
    affected_components_count: countSectionPaths(impactText, '## Components'),
    shared_component_changes: countSectionPaths(impactText, '## Shared / design-system components'),
    state_management_changes: countSectionPaths(impactText, '## Stores / state'),
    api_integration: countSectionPaths(impactText, '## APIs / services'),
    permissions_touchpoints: countSectionPaths(impactText, '## Permissions / auth touchpoints'),
    regression_areas_count: countSectionPaths(impactText, '## Regression areas'),
  };
}

function countSectionPaths(text, header) {
  const section = text.split(header)[1]?.split('\n## ')[0] || '';
  const paths = section.match(/^- `[^`]+`/gm) || [];
  return paths.filter((p) => !p.includes('none detected')).length;
}

export function analyzeFeatureRisk({ contractText = '', impactText = '', intake = {} }) {
  const combined = `${contractText}\n${impactText}\n${intake.context || ''}`.toLowerCase();
  const impact = parseImpactSignals(impactText);
  const signals = {
    high_risk: HIGH_RISK_KEYWORDS.filter((k) => combined.includes(k)),
    multi_step: MULTI_STEP_KEYWORDS.filter((k) => combined.includes(k)),
    low_risk_visual: LOW_RISK_KEYWORDS.filter((k) => combined.includes(k)),
    has_api: impact.api_integration > 0 || /api|endpoint|fetch|mutation|query/i.test(combined),
    has_forms: /form|validation|input|submit/i.test(combined),
    has_shared_components: impact.shared_component_changes > 0,
    has_routes: impact.affected_routes_count > 0,
    has_business_logic: /transform|filter|sort|calculate|logic|hook|store/i.test(combined) || impact.state_management_changes > 0,
    user_facing: impact.affected_routes_count > 0 || /user|ui|screen|page|component|ux/i.test(combined),
    user_journey_complexity: impact.affected_routes_count >= 2 || MULTI_STEP_KEYWORDS.some((k) => combined.includes(k)),
    figma_ui_feature: Boolean(intake?.figma?.url),
    regression_impact: impact.regression_areas_count,
    affected_routes_count: impact.affected_routes_count,
    affected_components_count: impact.affected_components_count,
    shared_component_changes: impact.shared_component_changes,
    state_management_changes: impact.state_management_changes,
    api_integration: impact.api_integration,
    permissions_touchpoints: impact.permissions_touchpoints,
  };
  return signals;
}

export function decideTestStrategy({ contractText = '', impactText = '', capabilities = {}, intake = {} }) {
  const signals = analyzeFeatureRisk({ contractText, impactText, intake });
  const hasUnitCap = Boolean(capabilities['unit-tests']?.present);
  const hasE2eCap = Boolean(capabilities['e2e-tests']?.present);

  const highRisk = signals.high_risk.length > 0;
  const multiStep = signals.multi_step.length > 0 || signals.user_journey_complexity;
  // One clear presentation-only signal is enough, provided nothing risky is present.
  // The guards below (no business logic, no high-risk keyword, no multi-step flow) are
  // what actually protect against under-testing, not an arbitrary keyword count.
  const lowRiskOnly =
    signals.low_risk_visual.length >= 1 &&
    !signals.has_business_logic &&
    !highRisk &&
    !multiStep;

  let unit = { required: false, reason: '' };
  let e2e = { required: false, reason: '' };
  let manual = { required: true, reason: 'Always include targeted manual verification for user-facing changes.' };

  if (lowRiskOnly) {
    unit = { required: false, reason: 'Low-risk visual/copy change with limited automated value.' };
    e2e = { required: false, reason: 'End-to-end workflow risk is minimal for layout/copy-only changes.' };
    manual = {
      required: true,
      reason: 'Visual and copy changes need human verification; automated tests provide limited value.',
    };
  } else if (signals.has_business_logic && !signals.user_facing) {
    unit = {
      required: hasUnitCap,
      reason: hasUnitCap
        ? 'Feature contains business logic, transforms, or isolated behavior best verified at unit level.'
        : 'Unit tests recommended but no unit-tests capability detected — document skip with evidence.',
    };
    e2e = {
      required: false,
      reason: 'Primarily non-UI logic; E2E adds limited value beyond unit coverage.',
    };
  } else if (highRisk || multiStep) {
    unit = {
      required: hasUnitCap,
      reason: hasUnitCap
        ? `High-risk or multi-step feature (${[...signals.high_risk, ...signals.multi_step].join(', ')}) with meaningful business logic.`
        : 'Unit tests strongly recommended; capability absent — record skip in verification plan.',
    };
    e2e = {
      required: hasE2eCap,
      reason: hasE2eCap
        ? `Critical user journey (${highRisk ? 'high-risk area' : 'multi-step workflow'}) requires browser-level verification.`
        : 'E2E tests strongly recommended; capability absent — expand manual QA and document skip.',
    };
  } else if (signals.user_facing && signals.has_business_logic) {
    unit = {
      required: hasUnitCap,
      reason: 'Combines user-facing behavior with business logic (filters, validation, state).',
    };
    e2e = {
      required: hasE2eCap,
      reason: 'Introduces or changes an important user-facing flow.',
    };
  } else if (signals.user_facing) {
    unit = { required: false, reason: 'Limited isolated logic; UI behavior is primary risk.' };
    e2e = {
      required: hasE2eCap,
      reason: 'User-facing feature where primary validation is the complete interaction path.',
    };
  } else {
    unit = {
      required: hasUnitCap && signals.has_business_logic,
      reason: signals.has_business_logic
        ? 'Business logic present; unit tests add value when capability exists.'
        : 'No significant isolated logic detected.',
    };
    e2e = { required: false, reason: 'No significant end-to-end user journey identified.' };
  }

  return {
    unit,
    e2e,
    manual,
    risk: computeRiskAutomationNeeds(signals),
    strategy_label: deriveStrategyLabel(unit, e2e, manual),
    signals,
    repository: {
      unit_framework: hasUnitCap ? detectFrameworkName(capabilities, 'unit') : 'Not detected',
      e2e_framework: hasE2eCap ? detectFrameworkName(capabilities, 'e2e') : 'Not detected',
    },
  };
}

function deriveStrategyLabel(unit, e2e, manual) {
  if (unit.required && e2e.required) return 'Unit + E2E';
  if (unit.required) return 'Unit only';
  if (e2e.required) return 'E2E only';
  if (manual.required) return 'Manual only';
  return 'Manual only';
}

function detectFrameworkName(capabilities, kind) {
  const evidence = kind === 'unit' ? capabilities['unit-tests']?.evidence : capabilities['e2e-tests']?.evidence;
  const joined = (evidence || []).join(' ').toLowerCase();
  if (joined.includes('vitest')) return 'Vitest';
  if (joined.includes('jest')) return 'Jest';
  if (joined.includes('playwright')) return 'Playwright';
  if (joined.includes('cypress')) return 'Cypress';
  if (joined.includes('mocha')) return 'Mocha';
  return 'Detected (see repository profile)';
}

export function generateUnitScenarios({ contractText, strategy }) {
  if (!strategy.unit.required) return [];
  const acItems = extractAcItemsWithIds(contractText);
  const scenarios = [];
  for (const { acId, text } of acItems) {
    scenarios.push(
      formatScenarioBullet({
        acId,
        scenarioId: formatScenarioId(acId, 1, 'T'),
        description: `Unit happy path — ${text}`,
      })
    );
    scenarios.push(
      formatScenarioBullet({
        acId,
        scenarioId: formatScenarioId(acId, 2, 'T'),
        description: `Unit negative case — rejects invalid or unauthorized input for "${text.slice(0, 40)}"`,
      })
    );
    scenarios.push(
      formatScenarioBullet({
        acId,
        scenarioId: formatScenarioId(acId, 3, 'T'),
        description: `Unit edge case — boundary / empty state for "${text.slice(0, 40)}"`,
      })
    );
    scenarios.push(
      formatScenarioBullet({
        acId,
        scenarioId: formatScenarioId(acId, 4, 'T'),
        description: `Unit error case — failure path surfaces a recoverable error for "${text.slice(0, 40)}"`,
      })
    );
  }
  return scenarios;
}

export function generateE2eScenarios({ contractText, strategy, intake }) {
  if (!strategy.e2e.required && !strategy.e2e.pendingApproval) return [];
  const acItems = extractAcItemsWithIds(contractText);
  const scenarios = [];
  for (const { acId, text } of acItems) {
    scenarios.push(
      formatScenarioBullet({
        acId,
        scenarioId: formatScenarioId(acId, 1, 'E'),
        description: `User completes flow — ${text} (verify UI and result)`,
      })
    );
  }
  if (intake?.figma && acItems.length) {
    scenarios.push(
      formatScenarioBullet({
        acId: acItems[0].acId,
        scenarioId: formatScenarioId(acItems[0].acId, 2, 'E'),
        description: 'Design-linked flow matches Figma states (loading, empty, error)',
      })
    );
  }
  return scenarios;
}

export function generateManualScenarios({ contractText, strategy }) {
  if (!strategy.manual.required) return [];
  const acItems = extractAcItemsWithIds(contractText);
  return acItems.map(({ acId, text }) =>
    formatScenarioBullet({
      acId,
      scenarioId: formatScenarioId(acId, 1, 'M'),
      description: `Manual verification — ${text}`,
    })
  );
}

export function renderTestStrategySection(strategy) {
  const req = (d) => {
    if (d.pendingApproval) return 'Required (pending setup approval)';
    return d.required ? 'Required' : 'Not Required';
  };
  const riskLines = [];
  if (strategy.signals.high_risk?.length) riskLines.push(`Business-critical keywords: ${strategy.signals.high_risk.join(', ')}`);
  if (strategy.signals.user_journey_complexity) riskLines.push('Multi-step or multi-route user journey');
  if (strategy.signals.shared_component_changes) riskLines.push(`Shared component impact (${strategy.signals.shared_component_changes} paths)`);
  if (strategy.signals.api_integration) riskLines.push(`API integration (${strategy.signals.api_integration} services)`);
  if (strategy.signals.figma_ui_feature) riskLines.push('Figma-linked UI feature');
  if (strategy.signals.regression_impact) riskLines.push(`Regression areas: ${strategy.signals.regression_impact}`);

  return `## Test Strategy

Strategy: ${strategy.strategy_label || 'Manual only'}

| Strategy | Required | Reason |
|----------|----------|--------|
| Unit Tests | ${req(strategy.unit)} | ${strategy.unit.reason} |
| E2E Tests | ${req(strategy.e2e)} | ${strategy.e2e.reason} |
| Manual QA | ${req(strategy.manual)} | ${strategy.manual.reason} |

Unit Tests: ${req(strategy.unit)}
E2E Tests: ${req(strategy.e2e)}
Manual QA: ${req(strategy.manual)}

### Risk signals

${riskLines.length ? riskLines.map((l) => `- ${l}`).join('\n') : '- _(none significant)_'}

### Repository capability

- Unit framework: ${strategy.repository.unit_framework}${strategy.repository.unit_status ? ` (${strategy.repository.unit_status})` : ''}
- E2E framework: ${strategy.repository.e2e_framework}${strategy.repository.e2e_status ? ` (${strategy.repository.e2e_status})` : ''}
`;
}

export function renderTestScenariosSection(unitScenarios, e2eScenarios, manualScenarios) {
  return `## Test Scenarios

### Unit test scenarios

${unitScenarios.length ? unitScenarios.map((s) => `- ${s}`).join('\n') : '- _(not required)_'}

### E2E test scenarios

${e2eScenarios.length ? e2eScenarios.map((s) => `- ${s}`).join('\n') : '- _(not required)_'}

### Manual test scenarios

${manualScenarios.length ? manualScenarios.map((s) => `- ${s}`).join('\n') : '- _(not required)_'}
`;
}

function replaceMarkdownSection(content, header, body) {
  if (!content.includes(header)) return null;
  return content.replace(
    new RegExp(`${header.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[\\s\\S]*?(?=\\n## |$)`),
    `${body.trim()}\n\n`
  );
}

export function applyTestStrategyToVerificationPlan(content, strategySection) {
  const replaced = replaceMarkdownSection(content, '## Test Strategy', strategySection);
  if (replaced) return replaced;
  const marker = '## Automated checks';
  if (content.includes(marker)) {
    return content.replace(marker, `${strategySection.trim()}\n\n${marker}`);
  }
  return `${content.trim()}\n\n${strategySection}\n`;
}

export function applyTestScenariosToPlan(content, scenariosSection) {
  const replaced = replaceMarkdownSection(content, '## Test Scenarios', scenariosSection);
  if (replaced) return replaced;
  const marker = content.includes('## Regression Scenarios')
    ? '## Regression Scenarios'
    : content.includes('## Regression Strategy')
      ? '## Regression Strategy'
      : content.includes('## Test Implementation')
        ? '## Test Implementation'
        : content.includes('## Automated checks')
          ? '## Automated checks'
          : '## Verification matrix';
  return content.replace(marker, `${scenariosSection.trim()}\n\n${marker}`);
}
