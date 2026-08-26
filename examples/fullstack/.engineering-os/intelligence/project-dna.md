# Project DNA

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** 2026-08-07
- **Root:** examples/fullstack
- **Archetype:** unknown
- **Files scanned:** 4

## Summary

Reusable inventory and conventions detected via heuristic scan. Categories with zero matches are intentionally empty — do not invent assets.

## Counts

| Category | Count |
|----------|------:|
| components | 0 |
| hooks | 0 |
| services | 1 |
| stores | 0 |
| utilities | 0 |
| routes | 1 |
| apis | 1 |
| design_system | 1 |
| other | 0 |

## Conventions

- src-layout
- ui-primitives
- api-layer

## Inventory samples

- **services** (1): src/modules/items.service.ts
- **routes** (1): src/pages/Home.tsx
- **apis** (1): src/api/items.ts
- **design_system** (1): src/components/ui/Button.tsx

## Capability snapshot

| Capability | Present | Evidence |
|------------|---------|----------|
| package_manager | no | — |
| lint | no | — |
| format | no | — |
| unit-tests | no | — |
| e2e-tests | no | — |
| ci | no | — |
| monorepo | no | — |
| backend-source | no | — |
| frontend | no | — |
| api-client-only | no | — |
| design-system | yes | src/components/ui |
| auth | no | — |
| build | no | — |
| typecheck | no | — |

## Backend availability note

- Do not assume backend implementation from frontend API clients alone.
- Use Backend Dependency artifacts for contract gaps.

## How to refresh

```bash
eos intel scan
eos intel graphs
```
