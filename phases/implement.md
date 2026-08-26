# Phase: Implement

## Goal

Execute the approved plan with reuse-first, repository-faithful changes.

## Inputs

- Approved contract (when required)
- Implementation Plan
- Cleared gates

## Steps

1. Confirm required gates are approved (`eos status`).
2. Implement only what the plan and contract allow.
3. Reuse existing patterns; update Decision Log for approved deviations.
4. Do not expand scope mid-flight without contract revision + re-approval.
5. Keep Backend Dependency honest — no invented APIs.

## Exit criteria

- [ ] Planned changes implemented (or blockers documented)
- [ ] Decision Log updated for material deviations
- [ ] Ready for verification

## Stop conditions

- Gate regression / new architectural need discovered — return to plan/approve
