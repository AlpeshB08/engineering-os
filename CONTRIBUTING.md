# Contributing to Engineering OS

Thank you for helping improve an AI-agnostic engineering framework.

## Principles for contributors

- Keep the framework **AI-tool agnostic**. Put tool-specific behavior only in `adapters/`.
- Prefer **declarative workflows** (YAML + phase markdown) over hard-coded prompt chains.
- Do not assume a target repository has backend access, tests, CI, or any capability not detected by evidence.
- Document new concepts in `docs/` and keep examples in sync.

## Development setup

```bash
git clone <repo-url> engineering-os
cd engineering-os
npm install
npm run validate
npm test
```

## How to contribute

1. Open an issue describing the change (new workflow, phase, standard, adapter, or bug).
2. Create a branch from `main`.
3. Make focused changes:
   - Workflows → `workflows/*.yaml` + docs in `docs/workflows/`
   - Phases → `phases/*.md` + `_index.yaml`
   - Engine → `engine/src/` + schemas in `engine/schemas/`
   - Adapters → `adapters/<tool>/`
4. Run `npm run validate` and `npm test`.
5. Update documentation when behavior changes.
6. Open a pull request with a clear summary and test plan.

## Adding a workflow

1. Create `workflows/<id>.yaml` following the schema in `engine/schemas/workflow.schema.json`.
2. Reuse existing phases from `phases/` when possible; add new phase markdown only when needed.
3. Add a human guide under `docs/workflows/<id>.md`.
4. Add or update an example under `examples/` if the workflow introduces new artifacts.

## Adding an adapter

1. Create `adapters/<tool>/` with install instructions and the files consumers should copy.
2. Adapters must **not** embed workflow logic — they must point agents at `eos status` / `eos next` and the core phase docs.
3. Document the adapter in `docs/adapters/<tool>.md`.

## Commit style

Use clear, conventional messages:

- `feat: ...` for new capabilities
- `fix: ...` for bug fixes
- `docs: ...` for documentation
- `refactor: ...` for internal restructuring without behavior change

## Code of conduct

Be respectful, assume good intent, and prioritize clarity for humans and AI agents that will read this repository.

## Phase 2 intelligence contributions

- Add scanners/heuristics under `engine/src/intelligence/`
- Prefer new artifacts + workflow YAML wiring over one-off prompts
- Keep detection evidence-based; never invent backend contracts
- Update `docs/intelligence.md` when adding commands
