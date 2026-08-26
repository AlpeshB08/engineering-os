# Phase: Plan

## Goal

Produce an Implementation Plan, Feature Impact, Reuse Analysis, Backend Dependency, and Verification Plan (with matrix) before code.

## Inputs

- Approved or draft Feature Contract (per workflow)
- Discovery notes
- Repository Profile + Project DNA + graphs
- Context pack from `eos context`

## Steps

1. Run `eos feature orchestrate-plan` to execute the plan intelligence bundle (preferred).
   Or manually: `eos intel impact`, `eos intel reuse`, `eos intel backend`, `eos intel test-strategy`, `eos intel verify-matrix`.
2. Build reuse map in Implementation Plan from reuse analysis (explain every decision).
3. Complete expanded `backend-dependency.md` — never invent endpoints.
4. Ensure `verification-plan.md` includes Test Strategy + matrix + regression scenarios.
5. Sequence implementation steps and likely files; set architectural impact honestly.
6. If architectural impact is yes: `eos set-flag architectural_impact true`.
7. Run `eos feature plan-bundle` before requesting human approval.

## Exit criteria

- [ ] `implementation-plan` complete
- [ ] `feature-impact` complete
- [ ] `reuse-analysis` complete
- [ ] `verification-plan` complete (matrix filled)
- [ ] `backend-dependency` complete when server contracts apply or availability ≠ clearly unused
- [ ] Architecture gate created when impact is yes

## Stop conditions

- Missing backend contracts with no stub strategy agreed
- Reuse analysis recommends create without justification

## Artifact status

When the artifact is ready, run `eos mark-artifact <id> <status>` (e.g. `ready`, `ready-for-approval`, `executed`, `complete`) or edit `EOS_ARTIFACT_STATUS` in the file.
