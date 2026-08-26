# ADR-0002: Never assume backend access

- **ID:** 0002-never-assume-backend
- **Type:** adr
- **Tags:** engineering-os
- **Summary:** See body.


- Status: accepted
- Date: 2026-08-07

## Context

Many tasks run in frontend-only checkouts or partial monorepos.

## Decision

Backend availability is explicit (`yes` | `no` | `unknown`). Missing contracts are captured in Backend Dependency artifacts; agents must not invent APIs.

## Consequences

Implementation may be blocked pending human input or an agreed stub strategy.
