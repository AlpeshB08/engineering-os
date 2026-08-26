# Reuse Analysis

<!-- EOS_ARTIFACT_STATUS: ready -->

- **Run ID:** feature-development-2026-08-12T08-11-31-999Z
- **Query:** Add export button to dashboard
- **Recommendation:** **reuse**

## Decision summary

Reuse `src/components/ui/Button.tsx` (design_system) — Strong name/path match (button, to); reuse existing design_system.

## Ranked candidates

| Score | Decision | Path | Kind | Rationale |
|------:|----------|------|------|-----------|
| 6 | reuse | `src/components/ui/Button.tsx` | design_system | Strong name/path match (button, to); reuse existing design_system. |

## New asset justification

- Not applicable if reusing/adapting.
- If still creating, explain rejection of top candidates.

## Rules

- Prefer design-system / shared components over one-offs.
- Do not introduce parallel UI kits or state libraries.
- Explain every reuse decision above.
