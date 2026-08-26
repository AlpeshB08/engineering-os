import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  assessArchitecturalRisk,
  extractCapabilityTokens,
  inspectRepositoryEvidence,
  reconcileBackendContext,
  BACKEND_SUPPORT,
} from './evidenceDiscovery.js';

function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-evidence-'));
  fs.mkdirSync(path.join(root, 'src', 'todos'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'components', 'ui'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'package.json'),
    JSON.stringify({
      name: 'spor-app',
      dependencies: { react: '19.0.0', '@nestjs/core': '10.0.0', express: '4.0.0' },
    })
  );
  fs.writeFileSync(path.join(root, 'src', 'main.ts'), 'import { NestFactory } from "@nestjs/core";\n');
  fs.writeFileSync(
    path.join(root, 'src', 'todos', 'todos.controller.ts'),
    `import { Controller, Get, Query } from '@nestjs/common';
@Controller('todos')
export class TodosController {
  @Get()
  list(@Query('hideCompleted') hideCompleted?: string) {
    return hideCompleted === 'true' ? [] : [{ id: 1, completed: true }];
  }
}
`
  );
  fs.writeFileSync(
    path.join(root, 'src', 'pages', 'Todos.tsx'),
    'export default function Todos() { return null; }\n'
  );
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'TaskList.tsx'),
    'export function TaskList({ hideCompleted }: { hideCompleted?: boolean }) { return hideCompleted; }\n'
  );
  fs.writeFileSync(
    path.join(root, 'src', 'components', 'ui', 'Button.tsx'),
    'export function Button() { return null; }\n'
  );
  return root;
}

test('extractCapabilityTokens finds hideCompleted from contract language', () => {
  const tokens = extractCapabilityTokens('Add hideCompleted support to the existing list.');
  assert.ok(tokens.includes('hideCompleted'));
});

test('inspectRepositoryEvidence marks hideCompleted backend support as supported', () => {
  const root = makeRepo();
  const evidence = inspectRepositoryEvidence({
    root,
    contractText: '## Acceptance Criteria\n1. Hide completed todos via hideCompleted\n',
  });
  assert.equal(evidence.backend.support, BACKEND_SUPPORT.SUPPORTED);
  assert.ok(evidence.backend.inspectable);
  assert.ok(evidence.backend.hits.some((p) => p.includes('todos.controller.ts')));
  assert.ok(evidence.frontend.hits.some((p) => p.includes('TaskList.tsx')));
  assert.equal(evidence.architecture.reviewRequired, false);
});

test('inspectRepositoryEvidence is unsupported when backend is inspectable but token is absent', () => {
  const root = makeRepo();
  fs.writeFileSync(path.join(root, 'src', 'todos', 'todos.controller.ts'), 'export function list() { return []; }\n');
  const evidence = inspectRepositoryEvidence({
    root,
    contractText: '## Acceptance Criteria\n1. Filter todos by hideArchived\n',
  });
  assert.equal(evidence.backend.support, BACKEND_SUPPORT.UNSUPPORTED);
});

test('inspectRepositoryEvidence is unavailable when no backend can be inspected', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'eos-fe-only-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export default function App() { return null; }\n');
  const evidence = inspectRepositoryEvidence({
    root,
    contractText: 'Use hideCompleted from the API.',
  });
  assert.equal(evidence.backend.support, BACKEND_SUPPORT.UNAVAILABLE);
  assert.equal(evidence.backend.inspectable, false);
});

test('reconcileBackendContext does not keep stale unknown when evidence is supported', () => {
  const reconciled = reconcileBackendContext(
    { needsBackend: true, availability: 'unknown', text: '**Backend availability:** unknown' },
    { tokens: ['hideCompleted'], backend: { support: BACKEND_SUPPORT.SUPPORTED, inspectable: true, hits: ['src/todos/todos.controller.ts'] } }
  );
  assert.equal(reconciled.support, BACKEND_SUPPORT.SUPPORTED);
  assert.equal(reconciled.availability, 'yes');
});

test('assessArchitecturalRisk ignores shared-component and existing-route signals', () => {
  const result = assessArchitecturalRisk({
    contractText: 'Add an additive hideCompleted prop to the existing TaskList on the current route without a new service or module.',
    impactSignals: { shared_component_changes: 4, affected_routes_count: 3, permissions_touchpoints: 0 },
  });
  assert.equal(result.reviewRequired, false);
});

test('assessArchitecturalRisk requires review for a new service and permission model', () => {
  const result = assessArchitecturalRisk({
    contractText: 'Create a new service and a new permission model for the shared infrastructure change.',
    impactSignals: { shared_component_changes: 0, permissions_touchpoints: 2 },
  });
  assert.equal(result.reviewRequired, true);
});
