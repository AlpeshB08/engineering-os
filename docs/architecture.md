# Architecture

Engineering OS is a **declarative orchestration framework**, not a hosted product and not an AI model.

## Layers

```text
┌─────────────────────────────────────────────┐
│  AI Adapters (Cursor, Claude, Copilot, …)   │  thin tool bindings
├─────────────────────────────────────────────┤
│  Workflow Engine (eos CLI + state)          │  orchestration
├─────────────────────────────────────────────┤
│  Workflows (YAML) + Phases (Markdown)       │  process definitions
├─────────────────────────────────────────────┤
│  Templates, Standards, Checklists, KB       │  knowledge & memory
└─────────────────────────────────────────────┘
```

## Design thesis

- **Workflow-driven, not prompt-driven.** Users start a named workflow; phases advance automatically when exit criteria and gates are satisfied.
- **AI-agnostic core.** All durable logic lives in workflows, phases, templates, and the CLI. Adapters only teach a tool how to enter the loop.
- **Repository-aware.** Capability detection and Repository Profile adapt behavior to Frontend, Backend, Fullstack, and Monorepo realities.
- **Gate-enforced.** Architecture and delivery require human approval recorded in state.

## Components

### Workflow engine

Located in `engine/`. Provides:

- State machine over workflow phases
- Capability detection
- Artifact scaffolding from templates
- Gate recording
- AI-readable “next step” output

Consumer state lives in `.engineering-os/state.json` inside the target repository.

### Workflows

YAML files in `workflows/`. Each lists an ordered phase sequence, required artifacts, and gates. Workflows compose the shared phase library.

### Phases

Markdown instructions in `phases/`. Phases are reusable across workflows. YAML owns *when* a phase runs; markdown owns *how* agents execute it.

### Templates

Markdown skeletons copied into `.engineering-os/artifacts/<run-id>/` when a workflow starts. They become the evidence trail for the run.

### Standards & checklists

Enforceable rules and QA/regression lists selected according to Repository Profile capabilities and archetype.

### Knowledge base

Baseline patterns, anti-patterns, ADRs, archetypes, and playbooks. Consumer repos may overlay `.engineering-os/knowledge-base/`.

### Adapters

Tool-specific install packs under `adapters/`. They must not duplicate workflow logic.

## Data flow for a typical feature

1. `eos init` / `eos detect` → Repository Profile + capabilities
2. `eos start feature-development` → run id, artifact set, phase = bootstrap
3. Agent follows `eos next` through discover → contract → plan
4. Human approves contract (and architecture if flagged)
5. Implement → verify → review → deliver
6. Human delivery sign-off → run complete

## Extension model

Add new workflows by YAML + docs. Add new phases by markdown + `_index.yaml`. Extend detection in `engine/src/detect.js`. Extend standards/KB without touching the CLI when possible.

## Non-goals

- Replacing CI/CD systems
- Hosting models or proprietary prompt marketplaces
- Assuming a single application stack
- Auto-merging or auto-deploying without human gates

## Phase 2 — Intelligence layer

```text
┌─────────────────────────────────────────────┐
│  AI Adapters                                │
├─────────────────────────────────────────────┤
│  Workflow Engine (eos CLI + state)          │
├─────────────────────────────────────────────┤
│  Intelligence (scan, graphs, impact, reuse, │
│  change-impact, context, knowledge)         │
├─────────────────────────────────────────────┤
│  Workflows / Phases / Templates / Standards │
└─────────────────────────────────────────────┘
```

Intelligence artifacts live under `.engineering-os/intelligence/` and feed discover/plan/verify phases. See [intelligence.md](intelligence.md).
