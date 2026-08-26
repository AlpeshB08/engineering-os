# Cursor Adapter

## Install

Copy files from `adapters/cursor/` into the target repository:

- `.cursor/rules/engineering-os.mdc`
- Optionally merge `AGENTS.md` snippets

Ensure `eos` is on `PATH` or set `ENGINEERING_OS_HOME`.

## Agent behavior

The rule instructs Cursor agents to:

1. Read `.engineering-os/state.json` or run `eos status`
2. Follow `eos next` for the current phase
3. Fill required templates before coding
4. Stop at pending gates

## Mutation enforcement (required for hard blocking)

Install fail-closed hooks from `adapters/cursor/.cursor/hooks.json` (see adapter README).

Verify after install:

```bash
eos guard capabilities --json
```

Hard tool-level blocking requires `effective_tier: "hard-hook"`. Without hooks, only engine CLI gates apply.

See [mutation-enforcement.md](../mutation-enforcement.md).
