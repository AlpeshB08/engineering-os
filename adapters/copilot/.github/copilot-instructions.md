# Copilot Instructions — Engineering OS

This repository uses Engineering OS, a workflow-driven engineering framework.

When assisting with features, bug fixes, refactors, reviews, audits, or releases:

1. Consult `.engineering-os/state.json` and prefer `eos status` / `eos next` guidance.
2. Do not skip discovery, contracts, planning, or verification phases.
3. Reuse existing repository patterns; do not invent parallel architectures.
4. Never invent backend APIs when backend availability is no/unknown.
5. Stop and request human answers in chat for architecture and testing decisions. When workflow decisions are pending, wait for explicit replies and continue with `eos feature continue --answer` — never auto-select an option.
6. Record verification evidence before delivery preparation.

Read `ENGINEERING_OS.md` for the full operating manual.

Use Engineering OS intelligence commands (`eos intel`, `eos context`, `eos knowledge`) during discovery and planning. Prefer Project DNA and context packs over repository-wide speculation.

**Mutation guard:** when `.engineering-os/state.json` exists, application file changes require `eos guard implementation` authorization (`implementation_permitted: true`). Install fail-closed hooks from the Cursor adapter when your host supports them.
