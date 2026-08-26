# Repository Profile

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** 2026-08-07
- **Root:** /Users/alpesh/Desktop/Projects/engineering-os/examples/fullstack
- **Archetype:** fullstack

## Summary

Detected archetype **fullstack** from filesystem and manifest evidence. Treat absences as unavailable — do not assume missing systems.

## Stack (evidenced)

| Area | Finding | Evidence |
|------|---------|----------|
| Languages | See capabilities / manifests | package.json, lockfiles, language markers |
| Frameworks | See frontend/backend capabilities | dependency and config evidence |
| Package manager | detected | pnpm-lock.yaml |
| Build tool | detected | package.json#scripts.build |
| Test runner | detected | see capabilities |
| Linter / formatter | lint=yes, format=yes | see capabilities |
| CI | detected | .github/workflows |

## Layout

Inspect the repository tree during discovery and extend this section with key directories.

## Capabilities

| Capability | Present | Evidence |
|------------|---------|----------|
| package_manager | yes | pnpm-lock.yaml |
| frontend | yes | package.json#react |
| lint | yes | eslint.config.js |
| format | yes | .prettierrc |
| unit-tests | yes | package.json#vitest |
| e2e-tests | yes | playwright.config.ts |
| ci | yes | .github/workflows |
| monorepo | no | — |
| backend-source | yes | package.json#@nestjs/core |
| api-client-only | no | — |
| design-system | yes | src/components/ui |
| auth | yes | package.json#jsonwebtoken |
| build | yes | package.json#scripts.build |
| typecheck | yes | tsconfig.json |

## Backend availability

- **Status:** yes
- **Notes:** Backend source markers detected in this repository.

## Reuse inventory

| Candidate | Path | Notes |
|-----------|------|-------|
| _(fill during discovery)_ | | |

## Constraints & conventions

- Follow existing repository patterns before inventing new ones.
- Never assume missing capabilities listed as `no` above.

## Unknowns

- Fill during discovery with explicit questions for humans.
