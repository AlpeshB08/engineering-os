# Workflow Engine

The Engineering OS engine is a small Node.js CLI (`eos`) plus JSON schemas.

## Commands

See the root [README](../README.md) for the command table.

## Modules

| File | Role |
|------|------|
| `src/cli.js` | Argument parsing and command dispatch |
| `src/paths.js` | Framework home + consumer root resolution |
| `src/state.js` | Load/save `.engineering-os/state.json` |
| `src/detect.js` | Capability and archetype detection |
| `src/artifacts.js` | Template rendering into run directories |
| `src/workflow.js` | Start workflow, complete phase, gate checks |
| `src/validate.js` | Schema and structural validation |

## State location

Consumer: `<repo>/.engineering-os/state.json`

## Intelligence modules

| File | Role |
|------|------|
| `src/intelligence/scan.js` | Heuristic inventory scan |
| `src/intelligence/dna.js` | Project DNA + bootstrap summaries |
| `src/intelligence/graphs.js` | Dependency graphs |
| `src/intelligence/impact.js` | Feature impact |
| `src/intelligence/reuse.js` | Ranked reuse |
| `src/intelligence/changeImpact.js` | Change blast radius |
| `src/intelligence/context.js` | Context packs |
| `src/intelligence/knowledge.js` | KB index/search |
