# Workflow: Bug Fix

**ID:** `bug-fix`

## Purpose

Fix defects with root-cause evidence, minimal scope, and mandatory verification.

## Phase sequence

bootstrap → discover → contract → plan → implement → verify → deliver

## Focus

- Reproduce and cite failing behavior
- Feature Contract is bug-scoped (symptoms, expected, actual, impact)
- Prefer smallest safe fix; avoid opportunistic refactors
- Architecture gate only if the fix requires structural change
