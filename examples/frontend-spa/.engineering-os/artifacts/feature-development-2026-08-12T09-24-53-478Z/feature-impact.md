# Feature Impact Analysis

<!-- EOS_ARTIFACT_STATUS: ready -->

- **Run ID:** feature-development-2026-08-12T09-24-53-478Z
- **Keywords:** export, development, 2026, approved, date, button, items, visible, backend, artifact, 12t09, 478z

## Affected modules

- (none detected — confirm manually)

## Components

- (none detected — confirm manually)

## Shared / design-system components

- `src/components/ui/Button.tsx`

## Routes / screens

- (none detected — confirm manually)

## APIs / services

- `src/api/items.ts`

## Stores / state

- (none detected — confirm manually)

## Permissions / auth touchpoints

- (none detected — confirm manually)

## Regression areas

- `src/api/items.ts`

## Reuse signal

- **Recommendation:** reuse
- Reuse `src/components/ui/Button.tsx` (design_system) — Strong name/path match (button); reuse existing design_system.

Top candidates:
- (5) `src/components/ui/Button.tsx` — reuse
- (3) `src/api/items.ts` — adapt

## Graph coverage used

- shared-components: 0 nodes / 0 edges
- api: 0 nodes / 0 edges
- routes: 0 nodes / 0 edges
- state: 0 nodes / 0 edges

## Notes

- Generated from Feature Contract + Project DNA + dependency graphs.
- Empty sections mean no heuristic match — investigate during planning; do not invent impact.
