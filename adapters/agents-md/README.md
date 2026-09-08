# AGENTS.md adapter

`AGENTS.md` is the de-facto open standard for giving coding agents project context, read by
Codex CLI, Gemini CLI, Windsurf, Amp, Jules and others.

## Install

Copy `AGENTS.md` to the **root** of your application repository:

```bash
cp adapters/agents-md/AGENTS.md /path/to/your-app/AGENTS.md
```

Commit it. Any AGENTS.md-aware agent will then follow the `/feature` workflow without a
tool-specific adapter.

Tool-specific adapters (`.cursor/`, `.claude/`) still add richer behaviour — notably native
interactive prompts — and can be installed alongside this file.
