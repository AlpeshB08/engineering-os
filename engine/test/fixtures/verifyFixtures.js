import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { templatesDir } from '../../src/paths.js';
import { replaceTokens, today } from '../../src/util.js';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..', '..');

export function writeFixtureBundle(dir, name, { runId = 'run-test-1', overrides = {}, files = null } = {}) {
  const bundleDir = path.join(dir, name);
  const artifactsDir = path.join(dir, '.engineering-os', 'artifacts', runId);
  fs.mkdirSync(artifactsDir, { recursive: true });
  const tokens = { run_id: runId, workflow_id: 'feature-development', date: today() };
  const home = REPO_ROOT;

  const defaultFiles = [
    'feature-contract.md',
    'verification-plan.md',
    'verification-evidence.md',
    'review-notes.md',
    'backend-dependency.md',
  ];
  for (const file of files || defaultFiles) {
    let content = fs.readFileSync(path.join(templatesDir(home), file), 'utf8');
    content = replaceTokens(content, tokens);
    if (overrides[file]) content = overrides[file];
    fs.writeFileSync(path.join(artifactsDir, file), content);
  }

  if (overrides.srcFile) {
    const srcPath = path.join(dir, overrides.srcFile);
    fs.mkdirSync(path.dirname(srcPath), { recursive: true });
    fs.writeFileSync(
      srcPath,
      overrides.srcContent || 'export function exampleFunction() { return true; }\n'
    );
  }
  for (const [relPath, content] of Object.entries(overrides.extraFiles || {})) {
    const fullPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, content);
  }

  return { artifactsDir, runId, bundleDir };
}

export function readyFixtures(runId = 'run-ready-1') {
  const contract = `# Feature Contract

## Problem

Export items to CSV from the items list page.

## Acceptance Criteria

1. Export button visible
2. CSV download works
`;

  const plan = `# Verification Plan

- **Run ID:** ${runId}

## Test Strategy

| Strategy | Required | Reason |
|----------|----------|--------|
| Unit Tests | Required | Unit tests add value |
| E2E Tests | Not Required | No E2E required |
| Manual QA | Not Required | Automated coverage sufficient |

Unit Tests: Required
E2E Tests: Not Required
Manual QA: Not Required

## Regression Strategy

Strategy: Not Required

Automated Regression: Not Required
Manual QA Regression: Not Required

## Test Scenarios

### Unit test scenarios

- AC1-T01: Unit happy path — Export button visible
- AC2-T01: Unit happy path — CSV download works

### E2E test scenarios

- _(not required)_

### Manual test scenarios

- _(not required)_

## Regression Scenarios

- _(not required)_

## QA Regression Scope

- _(not required)_

## Test Implementation

| AC | Scenario ID | File / location | Test name / scenario covered |
|----|-------------|-----------------|------------------------------|
| AC1 | AC1-T01 | tests/unit/example.test.js | export button visible |
| AC2 | AC2-T01 | tests/unit/example.test.js | csv download works |

## Verification matrix

| AC | Functional | Edge | Regression | Manual QA | Unit | E2E | A11y | Performance |
|----|------------|------|------------|-----------|------|-----|------|-------------|
| AC1: Export button visible | yes | | | | yes | N/A | | |
| AC2: CSV download works | yes | | | | yes | N/A | | |
`;

  const evidence = `# Verification Evidence

- **Run ID:** ${runId}

## Scenario coverage

| AC | Scenario ID | Run ID | Executed test / manual result | Status | Timestamp |
|----|-------------|--------|-------------------------------|--------|-----------|
| AC1 | AC1-T01 | ${runId} | tests/unit/example.test.js — export button visible | PASS | 2026-08-12 |
| AC2 | AC2-T01 | ${runId} | tests/unit/example.test.js — csv download works | PASS | 2026-08-12 |
`;

  const review = `# Review Notes

- **Run ID:** ${runId}

## Implementation references

| AC | File | Symbol | Description |
|----|------|--------|-------------|
| AC1 | src/example.js | exampleFunction | Export button component |
| AC2 | src/example.js | exampleFunction | CSV download handler |
`;

  return {
    'feature-contract.md': contract,
    'verification-plan.md': plan,
    'verification-evidence.md': evidence,
    'review-notes.md': review,
    srcFile: 'src/example.js',
    srcContent: 'export function exampleFunction() { return true; }\n',
    extraFiles: {
      'tests/unit/example.test.js':
        "import test from 'node:test';\n\ntest('AC1-T01: export button visible', () => {});\ntest('AC2-T01: csv download works', () => {});\n",
    },
  };
}

export function manualOnlyFixtures(runId = 'run-manual-1') {
  const contract = `# Feature Contract

## Problem

Export items to CSV from the items list page.

## Acceptance Criteria

1. Export button visible
2. CSV download works
`;

  const plan = `# Verification Plan

- **Run ID:** ${runId}

## Test Strategy

Unit Tests: Not Required
E2E Tests: Not Required
Manual QA: Required

## Regression Strategy

Strategy: Not Required

Automated Regression: Not Required
Manual QA Regression: Not Required

## Test Scenarios

### Unit test scenarios

- _(not required)_

### E2E test scenarios

- _(not required)_

### Manual test scenarios

- AC1-M01: Manual verification — Export button visible
- AC2-M01: Manual verification — CSV download works

## Regression Scenarios

- _(not required)_

## QA Regression Scope

- _(not required)_

## Test Implementation

| AC | Scenario ID | File / location | Test name / scenario covered |
|----|-------------|-----------------|------------------------------|

## Verification matrix

| AC | Functional | Edge | Regression | Manual QA | Unit | E2E | A11y | Performance |
|----|------------|------|------------|-----------|------|-----|------|-------------|
| AC1: Export button visible | yes | | | yes | N/A | N/A | | |
| AC2: CSV download works | yes | | | yes | N/A | N/A | | |
`;

  const evidence = `# Verification Evidence

- **Run ID:** ${runId}

## Manual check results

| AC | Scenario ID | Result | Notes |
|----|-------------|--------|-------|
| AC1 | AC1-M01 | Pass | Verified export button on items page |
| AC2 | AC2-M01 | Pass | Verified CSV download columns |

## Scenario coverage

| AC | Scenario ID | Run ID | Executed test / manual result | Status | Timestamp |
|----|-------------|--------|-------------------------------|--------|-----------|
| AC1 | AC1-M01 | ${runId} | Manual — export button visible | Passed | 2026-08-12 |
| AC2 | AC2-M01 | ${runId} | Manual — CSV download works | Passed | 2026-08-12 |
`;

  const review = `# Review Notes

- **Run ID:** ${runId}

## Implementation references

| AC | File | Symbol | Description |
|----|------|--------|-------------|
| AC1 | src/example.js | exampleFunction | Export button component |
| AC2 | src/example.js | exampleFunction | CSV download handler |
`;

  return {
    'feature-contract.md': contract,
    'verification-plan.md': plan,
    'verification-evidence.md': evidence,
    'review-notes.md': review,
    srcFile: 'src/example.js',
    srcContent: 'export function exampleFunction() { return true; }\n',
  };
}

export function staleRunEvidenceFixtures(runId = 'run-current', staleRunId = 'run-previous') {
  const base = readyFixtures(runId);
  const evidence = `# Verification Evidence

- **Run ID:** ${runId}

## Scenario coverage

| AC | Scenario ID | Run ID | Executed test / manual result | Status | Timestamp |
|----|-------------|--------|-------------------------------|--------|-----------|
| AC1 | AC1-T01 | ${staleRunId} | src/example.js — export button visible | Passed | 2026-08-12 |
| AC2 | AC2-T01 | ${staleRunId} | src/example.js — csv download works | Passed | 2026-08-12 |
`;
  return { ...base, 'verification-evidence.md': evidence };
}

export function invalidImplRefFixtures(runId = 'run-current') {
  const base = readyFixtures(runId);
  const review = `# Review Notes

- **Run ID:** ${runId}

## Implementation references

| AC | File | Symbol | Description |
|----|------|--------|-------------|
| AC1 | src/does-not-exist.js | exampleFunction | Export button component |
| AC2 | src/does-not-exist.js | exampleFunction | CSV download handler |
`;
  return { ...base, 'review-notes.md': review, srcFile: 'src/example.js' };
}

export function splitAcFixtures(runId = 'run-current') {
  const base = readyFixtures(runId);
  const evidence = `# Verification Evidence

- **Run ID:** ${runId}

## Scenario coverage

| AC | Scenario ID | Run ID | Executed test / manual result | Status | Timestamp |
|----|-------------|--------|-------------------------------|--------|-----------|
| AC1 | AC1-T01 | ${runId} | src/example.js — export button visible | Passed | 2026-08-12 |
`;
  const review = `# Review Notes

- **Run ID:** ${runId}

## Implementation references

| AC | File | Symbol | Description |
|----|------|--------|-------------|
| AC1 | src/example.js | exampleFunction | Export button component |
`;
  return { ...base, 'verification-evidence.md': evidence, 'review-notes.md': review };
}

export function regressionRequiredFixtures(runId = 'run-regression-1') {
  const base = readyFixtures(runId);
  const plan = base['verification-plan.md']
    .replace(
      'Strategy: Not Required',
      'Strategy: Automated + Manual'
    )
    .replace(
      'Automated Regression: Not Required',
      'Automated Regression: Required'
    )
    .replace(
      'Manual QA Regression: Not Required',
      'Manual QA Regression: Required'
    )
    .replace(
      /## Regression Scenarios\n\n- _\(not required\)_\n\n## QA Regression Scope\n\n- _\(not required\)_/,
      `## Regression Scenarios

- REG-001: changed \`src/components/ui/Button.tsx\` → consumer \`src/pages/UsersPage.tsx\` — Existing behavior unchanged [high risk, automated, manual QA]
- REG-002: changed \`src/components/ui/Button.tsx\` → consumer \`src/components/UserCard.tsx\` — Existing behavior unchanged [medium risk, automated, manual QA]

## QA Regression Scope

- UI flow using \`src/pages/UsersPage.tsx\` (REG-001)
- UI flow using \`src/components/UserCard.tsx\` (REG-002)`
    )
    .replace(
      '## Verification matrix',
      `## Regression Test Implementation

| REG ID | Test File / Reference | Test Type | Status |
|--------|----------------------|-----------|--------|
| REG-001 | tests/regression/button-users.spec.ts | e2e | implemented |
| REG-002 | tests/regression/button-card.spec.ts | e2e | implemented |

## Verification matrix`
    );

  const evidence = `# Verification Evidence

- **Run ID:** ${runId}

## Scenario coverage

| AC | Scenario ID | Run ID | Executed test / manual result | Status | Timestamp |
|----|-------------|--------|-------------------------------|--------|-----------|
| AC1 | AC1-T01 | ${runId} | tests/unit/example.test.js — export button visible | PASS | 2026-08-12 |
| AC2 | AC2-T01 | ${runId} | tests/unit/example.test.js — csv download works | PASS | 2026-08-12 |

## Regression execution evidence

| REG ID | Test reference | Current Run ID | Status | Evidence / notes |
|--------|----------------|----------------|--------|------------------|
| REG-001 | tests/regression/button-users.spec.ts | ${runId} | Passed | users page unchanged |
| REG-002 | tests/regression/button-card.spec.ts | ${runId} | Passed | user card unchanged |
`;

  return {
    ...base,
    'verification-plan.md': plan,
    'verification-evidence.md': evidence,
  };
}

export { REPO_ROOT };
