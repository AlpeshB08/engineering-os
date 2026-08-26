# Workflow: Refactoring

**ID:** `refactoring`

## Purpose

Improve structure without unintended behavior change. Risk and architecture gates are mandatory when impact is non-local.

## Phase sequence

bootstrap → discover → plan → approve → implement → verify → review → deliver

## Focus

- Explicit non-goals: no feature work unless separately contracted
- Characterization tests or verification steps required before claiming safety
- `architecture-approval` required when boundaries or public APIs change
