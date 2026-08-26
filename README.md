# Engineering OS

**AI-agnostic, workflow-driven software engineering framework.**

Engineering OS guides the full software development lifecycle—from requirement discovery to delivery preparation—for any AI coding assistant (Cursor, Claude Code, GitHub Copilot, Cline, Roo Code, Windsurf, and others).

It is **repository-aware**, **workflow-driven** (not prompt-driven), and **tool-independent**. Thin adapters map the same core to each AI tool.

## Why Engineering OS?

Most AI coding setups are a pile of prompts. Engineering OS replaces that with:

- Declared workflows that orchestrate phases automatically
- Required artifacts (contracts, plans, verification) before code
- Human approval gates for architecture and high-impact changes
- Capability detection so agents never assume missing systems
- A reusable knowledge base of patterns, anti-patterns, and playbooks

## Core principles

1. Discover before implementing
2. Reuse before creating
3. Repository-first, AI-second
4. Never assume missing systems (especially backend)
5. Never modify architecture without approval
6. Generate evidence, not assumptions
7. Verification is mandatory before delivery

See [docs/principles.md](docs/principles.md).

## Quick start

```bash
# From this repo (or after npm link / npx)
npm install
npm link   # optional: expose `eos` globally

# In a target application repository
cd /path/to/your-app
eos init
eos detect
eos feature --jira PROJ-123 --context "optional notes"
eos status
eos next
```

Then point your AI assistant at the adapter for your tool (see [Adapters](#adapters)) and ask it to follow the active workflow.

## Workflows

| Workflow | Purpose |
|----------|---------|
| `feature-development` | End-to-end feature delivery |
| `bug-fix` | Root-cause-driven bug fixes |
| `refactoring` | Safe structural change with risk gates |
| `repository-bootstrap` | First-run Project DNA + intelligence pack |
| `repository-audit` | Read-only architecture and quality audit |
| `code-review` | Diff-scoped review against standards |
| `release-preparation` | Verification, regression, delivery prep |

Each workflow composes shared phases. Humans and agents start a workflow once; the engine advances phase by phase.

## CLI (`eos`)

| Command | Purpose |
|---------|---------|
| `eos init` | Scaffold `.engineering-os/` in the current repo |
| `eos detect` | Detect capabilities and refresh Repository Profile |
| `eos start <workflow>` | Begin a workflow run and create artifacts |
| `eos feature [--jira …] [--figma …] [--context …]` | Start feature workflow with structured intake |
| `eos feature orchestrate-plan` | Run plan-phase intelligence bundle |
| `eos feature plan-bundle` | Validate approval bundle before gates |
| `eos status` | Show phase, gates, missing artifacts |
| `eos next` | Print AI-readable instructions for the current phase |
| `eos gate <id> --approve \| --reject` | Record a human approval gate |
| `eos complete-phase` | Advance when exit criteria are met |
| `eos validate` | Validate workflows, state, and schemas |
| `eos intel scan` | Build Project DNA + intelligence summaries |
| `eos intel graphs` | Generate dependency graphs |
| `eos intel jira` | Normalize Jira requirements (hybrid REST/MCP) |
| `eos intel test-strategy` | Risk-based test strategy + scenarios |
| `eos intel verify-matrix` | Fill verification matrix from contract |
| `eos intel backend` | Scaffold backend-dependency artifact |
| `eos intel impact` | Feature impact analysis for active run |
| `eos intel reuse <q>` | Ranked component reuse candidates |
| `eos intel change-impact <path>` | Blast radius for a change |
| `eos verify run` | Execute capability-gated engineering checks |
| `eos verify report` | Final report: READY FOR REVIEW / NOT READY / BLOCKED |
| `eos cleanup [--dry-run] [--run <id>]` | Safely remove finalized run-owned temporary artifacts |
| `eos context` | Slim phase context package |
| `eos knowledge search <q>` | Search engineering knowledge base |

## Repository layout

```
engineering-os/
├── docs/               # Framework documentation
├── engine/             # CLI + JSON schemas
├── workflows/          # Declarative workflow definitions
├── phases/             # Shared phase instructions
├── templates/          # Artifact templates
├── standards/          # Enforceable engineering standards
├── checklists/         # QA and regression checklists
├── knowledge-base/     # Patterns, anti-patterns, ADRs, playbooks
├── adapters/           # Cursor, Claude Code, Copilot, Generic
└── examples/           # Archetype snapshots
```

## Adapters

| Tool | Path |
|------|------|
| Cursor | [adapters/cursor](adapters/cursor) |
| Claude Code | [adapters/claude-code](adapters/claude-code) |
| GitHub Copilot | [adapters/copilot](adapters/copilot) |
| Generic (Cline, Roo, Windsurf, …) | [adapters/generic](adapters/generic) |

Adapters never embed workflow logic. They instruct agents to run `eos status` / `eos next`, fill templates, and stop at gates.

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Concepts](docs/concepts.md)
- [Installing into a repo](docs/installing-into-a-repo.md)
- [Extending workflows](docs/extending-workflows.md)
- [Engineering Intelligence](docs/intelligence.md)
- [Feature Development walkthrough](docs/workflows/feature-development.md)
- [Phase 2 closeout](docs/phase-2-engineering-intelligence.md)
- [Framework Readiness Report (Phase 3)](docs/framework-readiness-report.md)

## Consumer state

After `eos init`, the target repo contains:

```
.engineering-os/
├── state.json
├── repository-profile.md
├── artifacts/<run-id>/
└── knowledge-base/          # optional overlay
```

## License

MIT — see [LICENSE](LICENSE).
