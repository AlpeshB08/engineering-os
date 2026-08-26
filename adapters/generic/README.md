# Generic Adapter

For Cline, Roo Code, Windsurf, Aider, and any agent that reads repository instruction files.

## Install

Copy into the target repository root:

- `AGENTS.md`
- `ENGINEERING_OS.md`

Ensure `eos` is available (`npm link` from Engineering OS or set `ENGINEERING_OS_HOME`).

## Usage

Ask the agent: “Follow Engineering OS. Run `eos status` and `eos next`, then complete the current phase.”
