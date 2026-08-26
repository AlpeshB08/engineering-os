# Phase: Deliver

## Goal

Prepare delivery materials and obtain human delivery sign-off.

## Inputs

- Verification evidence (when applicable)
- Review notes (when applicable)
- Feature Contract / plans

## Steps

1. Fill `delivery-preparation.md` (summary, test plan, rollback, risks).
2. Ensure verification evidence exists for implementation workflows.
3. Request `delivery-signoff`.
4. Do not claim release completion without sign-off.

## Exit criteria

- [ ] Delivery Preparation complete
- [ ] `delivery-signoff` approved when required by workflow

## Stop conditions

- Missing verification evidence on workflows that changed product code

## Artifact status

When the artifact is ready, run `eos mark-artifact <id> <status>` (e.g. `ready`, `ready-for-approval`, `executed`, `complete`) or edit `EOS_ARTIFACT_STATUS` in the file.
