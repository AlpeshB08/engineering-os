/**
 * Helpers for verification matrix generation from acceptance criteria text.
 */

export function extractAcceptanceCriteria(contractText) {
  if (!contractText) return [];
  const section = contractText.split(/## Acceptance Criteria/i)[1] || '';
  const body = section.split(/\n## /)[0] || '';
  const items = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^\s*(?:\d+\.|[-*])\s+(.+)/);
    if (m && m[1].trim() && !m[1].includes('EOS_ARTIFACT')) items.push(m[1].trim());
  }
  return items;
}

export function buildVerificationMatrixRows(acceptanceCriteria, capabilities = {}) {
  const unit = capabilities['unit-tests']?.present ? 'planned' : 'N/A (no unit-tests capability)';
  const e2e = capabilities['e2e-tests']?.present ? 'planned' : 'N/A (no e2e-tests capability)';

  if (!acceptanceCriteria.length) {
    return [
      {
        ac: '(add acceptance criteria to Feature Contract)',
        functional: 'TBD',
        edge: 'TBD',
        regression: 'TBD',
        manual: 'TBD',
        unit,
        e2e,
        a11y: 'planned',
        performance: 'as needed',
      },
    ];
  }

  return acceptanceCriteria.map((ac, idx) => ({
    ac: `AC${idx + 1}: ${ac}`,
    functional: `Verify: ${ac}`,
    edge: 'Empty/invalid/error paths',
    regression: 'Related routes/components from feature-impact',
    manual: 'Walk primary UX path',
    unit,
    e2e,
    a11y: 'Keyboard + labels for touched UI',
    performance: 'N/A unless list/table/heavy render',
  }));
}

export function renderMatrixMarkdown(rows) {
  const header =
    '| AC | Functional | Edge | Regression | Manual QA | Unit | E2E | A11y | Performance |\n|----|------------|------|------------|-----------|------|-----|------|-------------|';
  const body = rows
    .map(
      (r) =>
        `| ${r.ac.replace(/\|/g, '/')} | ${r.functional.replace(/\|/g, '/')} | ${r.edge} | ${r.regression} | ${r.manual} | ${r.unit} | ${r.e2e} | ${r.a11y} | ${r.performance} |`
    )
    .join('\n');
  return `${header}\n${body}\n`;
}
