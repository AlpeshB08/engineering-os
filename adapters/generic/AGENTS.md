# AGENTS.md

This repository uses **Engineering OS** for software delivery workflows.

Before writing application code:

1. Read [ENGINEERING_OS.md](./ENGINEERING_OS.md)
2. Run `eos status` and `eos next`
3. Follow the active phase; produce required artifacts
4. Stop at unresolved questions and present them in chat. Continue the same `/feature` run with `eos feature continue --answer "<reply>"`. Never auto-answer.

If Engineering OS is not initialized, run `eos init` then `eos detect`.

Framework docs live in the Engineering OS install (`$ENGINEERING_OS_HOME`).
