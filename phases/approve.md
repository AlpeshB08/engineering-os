# Phase: Approve

## Goal

Enforce human approval gates before high-impact work proceeds.

## Inputs

- Feature Contract / Implementation Plan / Verification Plan bundle
- Pending gates in state

## Steps

1. Confirm `eos feature` completed the pre-approval pipeline (or resolve BLOCKED status via agent ingest).
2. Run `eos feature plan-bundle` (auto-run by pipeline) and present all plan artifacts to the human.
3. Run `eos status` and list pending gates.
4. Human runs `eos gate plan-approval --approve` (and `contract-approval` / `architecture-approval` if still pending).
5. On reject, return to contract/plan phases (do not implement).

## Exit criteria

- [ ] Plan bundle validates (`eos feature plan-bundle` exits 0)
- [ ] `plan-approval` gate is `approved`
- [ ] All other required gates for proceeding are `approved`
- [ ] Rejected gates addressed with revised artifacts

## Stop conditions

- Run status is BLOCKED (Jira/Figma discovery incomplete)
- Any required gate still `pending` or `rejected`
