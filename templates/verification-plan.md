# Verification Plan

<!-- EOS_ARTIFACT_STATUS: draft -->

- **Run ID:** {{run_id}}
- **Status:** draft | ready | executed

## Test Strategy

<!-- Filled by orchestration — Required/Not Required with auditable reasons -->

Unit Tests: Not Required
E2E Tests: Not Required
Manual QA: Required

## Regression Strategy

<!-- Filled by orchestration — automated/manual regression decision -->

Strategy: Not Required

Automated Regression: Not Required
Manual QA Regression: Not Required

## Test Scenarios

<!-- Filled by orchestration — unit / e2e / manual lists; prefix with AC ID where applicable -->

### Unit test scenarios

- _(not required)_

### E2E test scenarios

- _(not required)_

### Manual test scenarios

- _(not required)_

## Regression Scenarios

<!-- REG-### IDs must include changed/consumer paths, explicit high|medium|low risk, and automated/manual classification -->

- _(not required)_

## QA Regression Scope

<!-- Required when manual QA regression is Required -->

- _(not required)_

## Test Implementation

<!-- Required AC T/E rows need a repository-existing test file, exact scenario ID, and nonempty test name -->

| AC | Scenario ID | File / location | Test name / scenario covered |
|----|-------------|-----------------|------------------------------|
| | | | |

## Regression Test Implementation

<!-- Automated REG rows require a concrete test file/reference before verification can pass -->

| REG ID | Test File / Reference | Test Type | Status |
|--------|----------------------|-----------|--------|
| | | | |

## Automated checks (capability-gated)

| Check | Command | Capability required | Include? | Result |
|-------|---------|---------------------|----------|--------|
| lint | | lint | | |
| unit tests | | unit-tests | | |
| e2e | | e2e-tests | | |
| build | | build | | |
| typecheck | | typecheck | | |

## Verification matrix

Map each Acceptance Criterion to coverage dimensions. Use `N/A` with evidence when a capability is absent.

| AC | Functional | Edge | Regression | Manual QA | Unit | E2E | A11y | Performance |
|----|------------|------|------------|-----------|------|-----|------|-------------|
| AC1 | | | | | | | | |

### Matrix guidance

- **Functional** — happy path for the AC
- **Edge** — empty, invalid, unauthorized, conflict
- **Regression** — from `feature-impact.md` / graphs
- **Manual QA** — checklist items from `checklists/qa/*`
- **Unit / E2E** — only if Repository Profile capabilities allow
- **A11y** — keyboard, labels, focus for touched UI
- **Performance** — lists, tables, heavy renders only when relevant

## Manual checks

| AC | # | Scenario | Expected | Result |
|----|---|----------|----------|--------|
| AC1 | 1 | | | |

## Skips (must cite evidence)

| Check | Reason (missing capability / out of scope) | Evidence |
|-------|--------------------------------------------|----------|
| | | |

## Regression focus

<!-- Link feature-impact regression areas + checklists/regression/* -->

-

## Sign-off for execution

- Executed by:
- Date:
