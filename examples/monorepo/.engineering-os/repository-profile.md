# Repository Profile

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** 2026-08-07
- **Root:** /Users/alpesh/Desktop/Projects/engineering-os/examples/monorepo
- **Archetype:** monorepo

## Summary

Detected archetype **monorepo** from filesystem and manifest evidence. Treat absences as unavailable — do not assume missing systems.

## Stack (evidenced)

| Area | Finding | Evidence |
|------|---------|----------|
| Languages | See capabilities / manifests | package.json, lockfiles, language markers |
| Frameworks | See frontend/backend capabilities | dependency and config evidence |
| Package manager | detected | pnpm-lock.yaml |
| Build tool | detected | turbo.json |
| Test runner | detected | see capabilities |
| Linter / formatter | lint=yes, format=yes | see capabilities |
| CI | detected | .github/workflows |

## Layout

Inspect the repository tree during discovery and extend this section with key directories.

## Capabilities

| Capability | Present | Evidence |
|------------|---------|----------|
| package_manager | yes | pnpm-lock.yaml |
| frontend | yes | apps/web/package.json#react |
| lint | yes | eslint.config.js |
| format | yes | .prettierrc |
| unit-tests | yes | package.json#vitest |
| e2e-tests | no | — |
| ci | yes | .github/workflows |
| monorepo | yes | pnpm-workspace.yaml, turbo.json |
| backend-source | yes | apps/api/package.json#@nestjs/core |
| api-client-only | no | — |
| design-system | yes | packages/ui |
| auth | yes | apps/api |
| build | yes | turbo.json |
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
