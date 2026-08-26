# Reuse Analysis

<!-- EOS_ARTIFACT_STATUS: ready -->

- **Run ID:** feature-development-2026-08-12T09-24-53-478Z
- **Query:** CSV export demo
- **Recommendation:** **adapt**

## Decision summary

Prefer adapting `src/components/ui/Button.tsx` over greenfield creation.

## Ranked candidates

| Score | Decision | Path | Kind | Rationale |
|------:|----------|------|------|-----------|
| 2 | adapt | `src/components/ui/Button.tsx` | design_system | Partial match; consider adapting src/components/ui/Button.tsx before creating new. |

## New asset justification

- Not applicable if reusing/adapting.
- If still creating, explain rejection of top candidates.

## Rules

- Prefer design-system / shared components over one-offs.
- Do not introduce parallel UI kits or state libraries.
- Explain every reuse decision above.
