# Phase: Verify

## Goal

Prove the change with capability-aware checks, verification matrix coverage, and recorded evidence.

## Inputs

- Verification Plan (including matrix with AC IDs)
- Implementation references in review notes (file + symbol per AC)
- Feature impact regression areas
- QA / regression checklists
- Repository capabilities

## Steps

1. Fill **Implementation references** in `review-notes.md` with AC ID, file path, and symbol for each AC.
2. Fill **Test Implementation** and **Scenario coverage** in verification artifacts with matching AC IDs and current **Run ID**.
3. Run `eos verify run` to execute capability-gated checks (supplementary log only).
4. Record AC-specific results in `verification-evidence.md` Scenario coverage and Manual check results.
5. Run `eos verify report` for structured final status.
6. Document skips with evidence of missing capabilities.
7. Fail the phase if any AC remains Partial or Missing.

## Exit criteria

- [ ] Evidence Run ID matches active run
- [ ] Every AC has repository-verified implementation reference where required
- [ ] Every required AC has current-run execution evidence (Passed) or strategy-derived NotRequired
- [ ] `verification-evidence` present

## Stop conditions

- Critical failures without fix plan
- Stale evidence from a previous run used without regression tag
