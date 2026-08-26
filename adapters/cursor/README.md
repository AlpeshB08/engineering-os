# Cursor Adapter

## Install

From the target repo:

```bash
mkdir -p .cursor/rules .cursor/hooks
cp /path/to/engineering-os/adapters/cursor/.cursor/rules/engineering-os.mdc .cursor/rules/
cp /path/to/engineering-os/adapters/cursor/.cursor/hooks.json .cursor/
cp /path/to/engineering-os/adapters/cursor/.cursor/hooks/guard-implementation.sh .cursor/hooks/
chmod +x .cursor/hooks/guard-implementation.sh
cp /path/to/engineering-os/adapters/generic/AGENTS.md ./AGENTS.md
cp /path/to/engineering-os/adapters/generic/ENGINEERING_OS.md ./ENGINEERING_OS.md
```

Merge carefully if `AGENTS.md` already exists.

## Mutation guard hooks (required for fail-closed enforcement)

The adapter installs three fail-closed hooks (`preToolUse`, `beforeShellExecution`, `beforeMCPExecution`) that delegate to `eos guard hook`. They enforce the shared engine invariant:

- Application mutation is permitted **only** when `current_phase === "implement"` and all required decisions/gates are satisfied.
- `.engineering-os/**` remains writable during planning.
- Initialized EOS **without** an active run denies governed application mutation.

Requires `eos` on PATH (`npm link` from the Engineering OS package directory).

See `.cursor/hooks/README.md` for hook semantics.
