# Mutation enforcement

Engineering OS uses a **shared engine authorization policy** with optional **adapter-specific hard hooks**.

The engine is the single source of truth. Adapters delegate to `eos guard hook` — they must not implement separate decision logic.

## Authorization invariant

Governed **application** mutation is permitted **only** when **all** of the following hold:

```text
current_phase === "implement"
AND all required workflow_decisions are answered
AND no orchestration blockers exist
AND plan-approval is approved for the current run
AND contract-approval is approved
AND architecture-approval is approved when architectural_impact requires it
AND isImplementationPermitted(run) === true
```

During planning, `.engineering-os/**` artifact paths remain writable.

When EOS is initialized but **no active governed run** exists, application mutation is **denied**.

## Engine commands

| Command | Purpose |
|---------|---------|
| `eos guard implementation [--path <file>] [--json]` | Authorize a specific path or report current permission |
| `eos guard hook [--shell\|--mcp]` | Fail-closed hook entry (stdin JSON → allow/deny) |
| `eos guard capabilities [--json]` | Report effective enforcement tier and adapter limitations |

Shared authorization function: `evaluateMutationAuthorization()` in `engine/src/guard.js`.

## Enforcement tiers

| Tier | Meaning |
|------|---------|
| `inactive` | EOS not initialized — guard does not apply |
| `engine-only` | CLI/workflow gates only; agent tool mutations are **not** intercepted |
| `hard-hook` | Fail-closed hooks call `eos guard hook` before mutations |

Run `eos guard capabilities --json` in a consumer repo to see the **effective** tier.

## Adapter capability matrix

| Adapter | Hard hooks ship? | Effective when hooks installed | Without hooks |
|---------|------------------|-------------------------------|---------------|
| **Cursor** | Yes (`adapters/cursor/.cursor/hooks.json`) | `hard-hook` | `engine-only` |
| **Claude Code** | No | `engine-only` | `engine-only` |
| **GitHub Copilot** | No | `engine-only` | `engine-only` |
| **Generic** | No | `engine-only` | `engine-only` |

**Do not claim IDE-independent hard enforcement** unless `eos guard capabilities` reports `ide_independent_hard_enforcement: true` (requires hard hooks for **every** supported adapter — currently false).

`current_adapter_hard_enforcement` reflects whether the **current** Cursor hook pack is fully installed and wired. That is separate from engine-only authorization and from IDE-independent coverage.

## Mutation path coverage

| Path | Hook event | Fail-closed |
|------|------------|-------------|
| Write, StrReplace, Delete, ApplyPatch, EditNotebook | `preToolUse` | Yes (missing path → deny) |
| Shell redirects/destructive commands | `beforeShellExecution`, Shell/run_terminal_cmd/Bash in `preToolUse` | Yes — unknown or opaque commands deny unresolved |
| Dynamic local tools | CallDynamicTool in `preToolUse` | Yes — write-like first; unknown local targets deny unresolved |
| MCP write/upload tools | `beforeMCPExecution` | Yes — unresolved/unknown targets denied fail-closed |

### Known gaps (even with hooks)

- Read-only shell status is granted only when every segment of a compound command is proven read-only. Command substitutions, heredocs, interpreter eval, unknown package scripts, and opaque `find -exec` operations are denied unresolved.
- Only exact `node --test`, `npm test`, and `npm run test` commands are known-safe test commands; other npm/pnpm/yarn/bun run or exec forms are denied unresolved.
- Mutation targets must remain inside the canonical consumer root. Parent traversal, absolute outside paths, and symlink escapes are denied; aliases resolving into `.engineering-os` retain EOS scope.
- MCP tools with opaque write semantics or unresolved target paths are **denied fail-closed** (planning and implement).

## Integrating into another repository

1. `eos init` in the consumer repo
2. Install an adapter (see `docs/adapters/`)
3. **For hard enforcement:** copy Cursor hooks from `adapters/cursor/.cursor/hooks.json`
4. Verify: `eos guard capabilities --json`
5. Confirm `effective_tier` is `hard-hook` and `current_adapter_hard_enforcement` is true before relying on tool-level blocking

## Honesty rule

The framework reports enforcement truthfully:

- **Engine-only** adapters rely on workflow CLI gates (`complete-phase`, `plan-approval`, decision blockers) and agent discipline — not tool interception.
- **Hard-hook** requires installed hooks that delegate to `eos guard hook` with `failClosed: true`.
