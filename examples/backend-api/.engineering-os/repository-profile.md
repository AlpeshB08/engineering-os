# Repository Profile

<!-- EOS_ARTIFACT_STATUS: complete -->

- **Generated:** 2026-08-07
- **Root:** /Users/alpesh/Desktop/Projects/engineering-os/examples/backend-api
- **Archetype:** backend

## Summary

Detected archetype **backend** from filesystem and manifest evidence. Treat absences as unavailable — do not assume missing systems.

## Stack (evidenced)

| Area | Finding | Evidence |
|------|---------|----------|
| Languages | See capabilities / manifests | package.json, lockfiles, language markers |
| Frameworks | See frontend/backend capabilities | dependency and config evidence |
| Package manager | detected | package-lock.json |
| Build tool | detected | package.json#scripts.build |
| Test runner | detected | see capabilities |
| Linter / formatter | lint=yes, format=yes | see capabilities |
| CI | detected | .github/workflows |

## Layout

Inspect the repository tree during discovery and extend this section with key directories.

## Capabilities

| Capability | Present | Evidence |
|------------|---------|----------|
| package_manager | yes | package-lock.json |
| frontend | no | — |
| lint | yes | eslint.config.js |
| format | yes | .prettierrc |
| unit-tests | yes | package.json#jest |
| e2e-tests | no | — |
| ci | yes | .github/workflows |
| monorepo | no | — |
| backend-source | yes | nest-cli.json, package.json#@nestjs/core |
| api-client-only | no | — |
| design-system | no | — |
| auth | yes | package.json#passport |
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
