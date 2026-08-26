# Installing into a Repository

## What gets added

`eos init` creates:

```text
.engineering-os/
├── state.json                 # engine state (local)
├── repository-profile.md      # filled/updated by eos detect
├── artifacts/                 # workflow run outputs
├── knowledge-base/            # optional local overlay (empty by default)
└── README.md                  # pointer for humans and agents
```

Framework source (workflows, phases, templates) remains in the Engineering OS install path. The CLI resolves the framework root via `ENGINEERING_OS_HOME` or by walking from the `eos` binary location.

## Environment variable

```bash
export ENGINEERING_OS_HOME=/path/to/engineering-os
```

If unset, `eos` derives the framework root as two directories above `engine/src/cli.js`.

## Adapter installation

Copy or merge the files from one adapter:

| Tool | Source | Hard mutation hooks |
|------|--------|---------------------|
| Cursor | `adapters/cursor/` | Yes — install `.cursor/hooks.json` |
| Claude Code | `adapters/claude-code/` | No — engine-only |
| Copilot | `adapters/copilot/` | No — engine-only |
| Generic | `adapters/generic/` | No — engine-only |

See `docs/adapters/` for per-tool steps.

After installation, verify enforcement:

```bash
eos guard capabilities --json
```

See [mutation-enforcement.md](mutation-enforcement.md) for the authorization invariant and honesty rules.

## Monorepos

Run `eos init` at the monorepo root unless a package is an independent product with its own release train. Detection records workspace tools (pnpm/nx/turbo) in the Repository Profile.

For package-scoped work, note the package path in the Feature Contract and Implementation Plan; keep a single `.engineering-os/` at the root for shared state.

## Git and CI guidance

Do **not** commit secrets. Keep runtime state and staging local by using the recommended ignore entries below. Engineering OS excludes every `.engineering-os/` path when calculating implementation changes, so metadata-only edits cannot be mistaken for application changes.

Committing completed, durable artifacts is optional and useful for auditability. Review them like any other generated documentation before adding them. Do not use `git add .engineering-os` indiscriminately: `state.json`, staging, caches, and scratch data are local runtime data.

## Upgrading the framework

Pull or reinstall Engineering OS, then run `eos validate` in the consumer repo. Workflow IDs are stable; additive phase fields are preferred over breaking renames.

## Consumer Git behavior

```gitignore
# Engineering OS runtime artifacts (managed by eos init)
.engineering-os/state.json
.engineering-os/artifacts/
.engineering-os/integrations/jira-*.json
.engineering-os/integrations/figma-discovery.json
.engineering-os/intelligence/context/
.engineering-os/test-setup-staging/
.engineering-os/tmp/
.engineering-os/cache/
.engineering-os/scratch/
```

`eos init` adds this managed block to the repository `.gitignore` without replacing
existing entries. See `.engineering-os/recommended-gitignore.txt` for the full guidance.

Commit reusable project metadata such as `.engineering-os/repository-profile.md`,
project intelligence, and authored knowledge-base entries. Feature runtime artifacts
do not need to be committed or pushed.

After current-run verification reports `READY FOR REVIEW`, review and delivery finish,
and the run-bound `delivery-signoff` gate is approved, completing the deliver phase
automatically removes temporary feature artifacts. The existing
`delivery-preparation.md` is retained as the sole optional durable feature record.

For finalized failed or aborted runs, use `eos cleanup --dry-run --run <run-id>` to
inspect the exact plan, then `eos cleanup --run <run-id>`. Active, blocked, and
verification-incomplete runs are always preserved.
