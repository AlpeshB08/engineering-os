# Phase: Contract

## Goal

Agree on scope through a Feature Contract (or bug-scoped contract).

## Inputs

- Discovery notes
- Human clarifications

## Steps

1. Draft `feature-contract.md` with problem, scope in/out, acceptance criteria, non-goals.
2. Record backend availability constraint.
3. Mark contract status `ready-for-approval`.
4. Request `contract-approval` gate (do not implement yet).

## Exit criteria

- [ ] Feature Contract complete
- [ ] Gate `contract-approval` recorded as approved (workflow may require this before leaving phase or before implement)

## Stop conditions

- Scope ambiguity unresolved after questions

## Artifact status

When the artifact is ready, run `eos mark-artifact <id> <status>` (e.g. `ready`, `ready-for-approval`, `executed`, `complete`) or edit `EOS_ARTIFACT_STATUS` in the file.
