# Adapters

Adapters teach a specific AI tool how to enter the Engineering OS loop. They never embed workflow logic or separate authorization rules.

| Adapter | Guide | Hard mutation hooks |
|---------|-------|---------------------|
| Cursor | [cursor.md](cursor.md) | Yes |
| Claude Code | [claude-code.md](claude-code.md) | No (engine-only) |
| GitHub Copilot | [copilot.md](copilot.md) | No (engine-only) |
| Generic | [generic.md](generic.md) | No (engine-only) |

Install steps live with the adapter packs under `adapters/<tool>/`.

All adapters delegate mutation authorization to the shared engine (`evaluateMutationAuthorization` / `eos guard hook`). Run `eos guard capabilities` after install to verify the effective enforcement tier.

See [mutation-enforcement.md](../mutation-enforcement.md).
