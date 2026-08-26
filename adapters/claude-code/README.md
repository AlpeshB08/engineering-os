# Claude Code Adapter

## Install

```bash
cp /path/to/engineering-os/adapters/claude-code/CLAUDE.md ./CLAUDE.md   # or merge
mkdir -p .claude/commands
cp /path/to/engineering-os/adapters/claude-code/.claude/commands/*.md .claude/commands/
cp /path/to/engineering-os/adapters/generic/ENGINEERING_OS.md ./ENGINEERING_OS.md
```

## Mutation guard

If your Claude Code host supports Cursor-compatible hooks, install the same fail-closed hooks from `adapters/cursor/.cursor/hooks.json` and call `eos guard hook` before file/shell/MCP mutations. The engine (`eos guard implementation`) is the authoritative authorization source.
