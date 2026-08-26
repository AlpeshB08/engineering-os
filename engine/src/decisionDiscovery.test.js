import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  detectAmbiguousAcceptanceCriteria,
  detectJiraFigmaConflicts,
  discoverArchitecturalDecisions,
  discoverImplementationDecisions,
  discoverRegressionDecisions,
  discoverRequirementDecisions,
  discoverSourceConflictDecisions,
} from './decisionDiscovery.js';
import { eosDir } from './paths.js';
import { DECISION_IDS, DECISION_STATUS, getWorkflowDecision } from './workflowDecisions.js';

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-ddisc-'));
  fs.mkdirSync(path.join(eosDir(root), 'integrations'), { recursive: true });
  return root;
}

test('detectAmbiguousAcceptanceCriteria finds TBD and unclear AC patterns', () => {
  const contract = `
## Acceptance criteria
- User can export CSV
- Retention period TBD
- Delete flow is unclear
`;
  const ambiguous = detectAmbiguousAcceptanceCriteria(contract);
  assert.equal(ambiguous.length, 2);
  assert.ok(ambiguous.some((a) => /TBD/i.test(a.text)));
});

test('clear acceptance criteria do not register requirement decision', () => {
  const run = {};
  discoverRequirementDecisions(run, {
    contractText: `
## Acceptance criteria
- User can export CSV
- User can export PDF
`,
  });
  assert.equal(getWorkflowDecision(run, DECISION_IDS.REQUIREMENT_CLARITY), null);
  assert.equal(getWorkflowDecision(run, 'clarification:acceptance-criteria'), null);
});

test('missing acceptance criteria register a free-text clarification question', () => {
  const run = {};
  discoverRequirementDecisions(run, {
    contractText: '# Feature Contract\n\n## Problem\n\nSomething vague\n\n## Acceptance Criteria\n\n1.\n',
    intake: { context: 'improve dashboard' },
  });
  const decision = getWorkflowDecision(run, 'clarification:acceptance-criteria');
  assert.equal(decision.status, DECISION_STATUS.PENDING);
  assert.equal(decision.answerType, 'free_text');
  assert.match(decision.question, /acceptance criteria/i);
});

test('ambiguous acceptance criteria register a free-text clarification question', () => {
  const run = {};
  discoverRequirementDecisions(run, {
    contractText: `
## Acceptance criteria
- Export format depends on user role
`,
  });
  const decision = getWorkflowDecision(run, 'clarification:ac1');
  assert.equal(decision.status, DECISION_STATUS.PENDING);
  assert.equal(decision.answerType, 'free_text');
  assert.match(decision.question, /unresolved/i);
});

test('material Jira open question creates a clarification question', () => {
  const root = makeRoot();
  fs.writeFileSync(
    path.join(eosDir(root), 'integrations', 'jira-PROJ-1.json'),
    JSON.stringify({
      key: 'PROJ-1',
      open_questions: ['Should destructive delete be supported in this release?'],
    })
  );
  const run = {};
  discoverRequirementDecisions(run, {
    intake: { jira: { key: 'PROJ-1' } },
    contractText: 'Export workflow scope',
    root,
    eosRoot: root,
  });
  const pending = Object.values(run.workflow_decisions || {}).filter((d) => d.status === DECISION_STATUS.PENDING);
  assert.ok(pending.some((d) => /destructive delete/i.test(d.question)));
});

test('detectJiraFigmaConflicts finds scope mismatch between Figma delete and contract export', () => {
  const root = makeRoot();
  fs.writeFileSync(
    path.join(eosDir(root), 'integrations', 'jira-PROJ-2.json'),
    JSON.stringify({ key: 'PROJ-2', open_questions: [] })
  );
  fs.writeFileSync(
    path.join(eosDir(root), 'integrations', 'figma-discovery.json'),
    JSON.stringify({
      screens: ['Settings'],
      interactions: ['User can delete account from settings'],
      open_questions: [],
    })
  );
  const conflicts = detectJiraFigmaConflicts({
    intake: { jira: { key: 'PROJ-2' }, figma: { url: 'https://figma.com/design/x' } },
    contractText: 'Users can export their data. Export-only scope for this release.',
    root,
    eosRoot: root,
  });
  assert.ok(conflicts.some((c) => c.kind === 'figma_jira_scope'));
});

test('regression scope decision when shared impact spans multiple high-risk consumers', () => {
  const run = {};
  discoverRegressionDecisions(run, {
    regressionImpact: {
      candidates: [
        { risk: 'high', changedPath: 'src/shared/Button.tsx', consumerPath: 'src/pages/A.tsx' },
        { risk: 'high', changedPath: 'src/shared/Button.tsx', consumerPath: 'src/pages/B.tsx' },
        { risk: 'medium', changedPath: 'src/shared/Button.tsx', consumerPath: 'src/pages/C.tsx' },
        { risk: 'low', changedPath: 'src/shared/Button.tsx', consumerPath: 'src/pages/D.tsx' },
      ],
    },
  });
  const decision = getWorkflowDecision(run, DECISION_IDS.REGRESSION_SCOPE);
  assert.equal(decision.status, DECISION_STATUS.PENDING);
  assert.ok(decision.options.some((o) => o.id === 'full_regression_scope'));
});

test('small regression impact does not create regression decision', () => {
  const run = {};
  discoverRegressionDecisions(run, {
    regressionImpact: {
      candidates: [{ risk: 'low', changedPath: 'src/a.ts', consumerPath: 'src/a.ts' }],
    },
  });
  assert.equal(getWorkflowDecision(run, DECISION_IDS.REGRESSION_SCOPE), null);
});

test('localized shared-component or route changes do not ask for architecture review', () => {
  const run = { flags: {} };
  discoverArchitecturalDecisions(run, {
    contractText: 'Add an optional hideCompleted prop to the existing TaskList on the current todos route.',
    impactSignals: { shared_component_changes: 3, affected_routes_count: 2, permissions_touchpoints: 0 },
  });
  assert.equal(getWorkflowDecision(run, DECISION_IDS.ARCHITECTURAL_IMPACT), null);
  assert.equal(run.flags.architecture_review_decision, 'no_architecture_review');
});

test('genuine architectural risk still asks for architecture review', () => {
  const run = { flags: {} };
  discoverArchitecturalDecisions(run, {
    contractText: 'Introduce a new service module and a new permission model for cross-system contract redesign.',
    impactSignals: { shared_component_changes: 1, affected_routes_count: 1, permissions_touchpoints: 2 },
  });
  const decision = getWorkflowDecision(run, DECISION_IDS.ARCHITECTURAL_IMPACT);
  assert.equal(decision.status, DECISION_STATUS.PENDING);
  assert.match(decision.question, /architectural/i);
});

test('architectural flag already set skips architectural decision', () => {
  const run = { flags: { architectural_impact: true } };
  discoverArchitecturalDecisions(run, {
    impactSignals: { shared_component_changes: 5, affected_routes_count: 4, permissions_touchpoints: 3 },
  });
  assert.equal(getWorkflowDecision(run, DECISION_IDS.ARCHITECTURAL_IMPACT), null);
});

test('discoverImplementationDecisions preserves independent state for multiple domains', () => {
  const dir = makeRoot();
  fs.writeFileSync(
    path.join(dir, 'package.json'),
    JSON.stringify({ scripts: { test: 'vitest run' }, devDependencies: { vitest: '2.0.0' } })
  );
  fs.writeFileSync(path.join(dir, 'vitest.config.ts'), 'export default {}');

  const run = {};
  discoverImplementationDecisions(run, {
    resolved: {
      strategy: { risk: { e2e: true } },
      testCapabilities: { e2e: { status: 'unavailable' } },
    },
    backend: { needsBackend: true, availability: 'unknown' },
    contractText: '## Acceptance criteria\n- Behavior depends on backend availability',
    regressionImpact: {
      candidates: [
        { risk: 'high', changedPath: 'src/shared/X.tsx', consumerPath: 'src/a.tsx' },
        { risk: 'high', changedPath: 'src/shared/X.tsx', consumerPath: 'src/b.tsx' },
        { risk: 'medium', changedPath: 'src/shared/X.tsx', consumerPath: 'src/c.tsx' },
        { risk: 'low', changedPath: 'src/shared/X.tsx', consumerPath: 'src/d.tsx' },
      ],
    },
    impactSignals: { shared_component_changes: 2, affected_routes_count: 0, permissions_touchpoints: 0 },
    intake: {},
    root: dir,
    eosRoot: dir,
  });

  assert.equal(getWorkflowDecision(run, DECISION_IDS.E2E_AUTOMATION)?.status, DECISION_STATUS.PENDING);
  assert.equal(getWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY)?.status, DECISION_STATUS.PENDING);
  assert.equal(getWorkflowDecision(run, 'clarification:ac1')?.status, DECISION_STATUS.PENDING);
  assert.equal(getWorkflowDecision(run, DECISION_IDS.REGRESSION_SCOPE)?.status, DECISION_STATUS.PENDING);
  assert.equal(getWorkflowDecision(run, DECISION_IDS.ARCHITECTURAL_IMPACT), null);
});

test('hideCompleted backend support is resolved from repository evidence and is not asked', () => {
  const root = makeRoot();
  fs.mkdirSync(path.join(root, 'src', 'todos'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({ dependencies: { '@nestjs/core': '10.0.0', express: '4.0.0' } })
  );
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'export const app = true;\n');
  fs.writeFileSync(
    path.join(root, 'src', 'todos', 'todos.controller.ts'),
    'export function list(hideCompleted?: boolean) { return hideCompleted; }\n'
  );
  const artifactsDir = path.join(root, 'artifacts');
  fs.mkdirSync(artifactsDir, { recursive: true });
  fs.writeFileSync(
    path.join(artifactsDir, 'backend-dependency.md'),
    '# Backend\n- **Backend availability:** unknown\n- Needs backend per contract heuristics: yes\n'
  );
  const run = { artifacts_dir: artifactsDir, flags: {} };
  discoverImplementationDecisions(run, {
    resolved: { strategy: { risk: {} }, testCapabilities: {} },
    backend: { needsBackend: true, availability: 'unknown' },
    contractText: '## Acceptance criteria\n- Hide completed todos using hideCompleted\n',
    impactSignals: { shared_component_changes: 2, affected_routes_count: 1, permissions_touchpoints: 0 },
    root,
  });
  assert.equal(getWorkflowDecision(run, DECISION_IDS.BACKEND_DEPENDENCY), null);
  assert.equal(run.flags.backend_support, 'supported');
  assert.equal(getWorkflowDecision(run, DECISION_IDS.ARCHITECTURAL_IMPACT), null);
  assert.match(fs.readFileSync(path.join(artifactsDir, 'backend-dependency.md'), 'utf8'), /Backend support:\*\* supported/i);
});
