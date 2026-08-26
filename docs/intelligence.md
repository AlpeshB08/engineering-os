# Engineering Intelligence

Phase 2 adds an intelligence layer on top of the Phase 1 workflow engine. It does not replace workflows — it feeds them.

## Commands

| Command | Purpose |
|---------|---------|
| `eos feature` | Start feature workflow with Jira/Figma/context intake |
| `eos feature orchestrate-plan` | Plan-phase intelligence bundle |
| `eos intel scan` | Project DNA + bootstrap summaries |
| `eos intel graphs` | Shared component / API / route / state graphs |
| `eos intel jira` | Normalize Jira requirements (hybrid REST/MCP) |
| `eos intel test-strategy` | Risk-based test strategy + scenarios |
| `eos intel verify-matrix` | Fill verification matrix from contract |
| `eos intel backend` | Scaffold backend-dependency artifact |
| `eos intel impact` | Feature impact from contract + DNA |
| `eos intel reuse <query>` | Ranked reuse candidates |
| `eos intel change-impact <path>` | Blast radius for a file/component |
| `eos verify run` | Execute capability-gated checks |
| `eos verify report` | Final verification report + status |
| `eos context [phase]` | Slim phase context pack |
| `eos knowledge index` | Build KB search index |
| `eos knowledge search <q>` | Search framework + consumer KB |
| `eos knowledge add <type> <title>` | Scaffold a local KB entry |

## Project DNA

Written to:

- `.engineering-os/intelligence/project-dna.json`
- `.engineering-os/intelligence/project-dna.md`

Also produced by scan:

- `capability-matrix.md`
- `architecture-summary.md`
- `reuse-inventory.md`
- `known-risks.md`
- `standards-summary.md`

## Dependency graphs

Under `.engineering-os/intelligence/graphs/`:

- `shared-components`
- `api`
- `routes`
- `state`

Each as `.json` + `.mmd` (Mermaid).

## Workflow integration

- **repository-bootstrap** — first-run DNA + summaries
- **feature-development / bug-fix / refactoring** — plan phase requires `feature-impact` + `reuse-analysis`
- **`eos next`** — auto-writes a context pack and prints its path

## Rules

- Heuristic only — empty means unknown, not absent forever
- Never invent backend contracts from DNA
- Prefer context packs over full-repo prompt dumps
