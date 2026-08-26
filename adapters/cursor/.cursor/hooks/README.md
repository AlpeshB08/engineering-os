# Engineering OS — Mutation Guard Hooks

Fail-closed hooks call `eos guard hook` before application mutations:

| Hook event | Command | Covers |
|------------|---------|--------|
| `preToolUse` | `eos guard hook` | Write, StrReplace, Delete, ApplyPatch, Shell tool |
| `beforeShellExecution` | `eos guard hook --shell` | Shell redirects and destructive commands |
| `beforeMCPExecution` | `eos guard hook --mcp` | MCP write/upload tools |

All hooks use `"failClosed": true`.

## Authorization rules

When Engineering OS is **initialized**:

- `.engineering-os/**` → **ALLOW** (artifact planning)
- Application paths → **ALLOW** only when `isImplementationPermitted(run)` is true
- No active run → **DENY** application mutation

When Engineering OS is **not initialized**:

- Guard is **inactive** (unchanged non-EOS behavior)

## Fail-closed guarantees

For mutation requests, the hook **never** returns `{"permission":"allow"}` when:

- stdin/JSON is invalid
- a file mutation tool omits its target path
- EOS is initialized but no active governed run exists
- the critical invariant is not satisfied

Install with `adapters/cursor/README.md`.
