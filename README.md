# Engineering OS

**AI-agnostic, workflow-driven `/feature` delivery for any AI coding assistant.**

Engineering OS turns a Jira ticket, Figma design, or plain task description into a
tested, verified feature through one coherent, conversational workflow — the same
active run from intake to delivery, with human decisions and approvals happening
**in the chat**, never in a separate CLI ceremony.

It is **repository-aware**, **workflow-driven** (not prompt-driven), and
**tool-independent**. Thin adapters map the same core to each AI tool (Cursor,
Claude Code, GitHub Copilot, Cline, Roo Code, Windsurf, and others).

## Why Engineering OS?

Most AI coding setups are a pile of prompts. Engineering OS replaces that with:

- One declared `/feature` workflow that orchestrates every phase automatically
- Required artifacts (contract, plan, verification evidence) before code
- Human approval gates and clarifications resolved in the same conversation
- Capability detection so agents never assume missing systems (backend, E2E, …)
- A fail-closed mutation guard so application code cannot change before it is authorized

## Core principles

1. Discover before implementing
2. Reuse before creating
3. Repository-first, AI-second
4. Never assume missing systems (especially backend and E2E)
5. Never modify architecture without approval
6. Generate evidence, not assumptions
7. Verification is mandatory before delivery

See [docs/principles.md](docs/principles.md).

## The `/feature` workflow

Engineering OS ships a single, authoritative workflow: **`feature-development`**,
driven end-to-end through `eos feature`. Its phases run in one active run:

```
Intake            Jira / Figma / task description (no application code is touched)
  → Discovery     Ingest and normalize the requirement source
  → Clarification Ask every unresolved question in chat; re-analyze after each
                  answer and ask any newly discovered question before proceeding
  → Testing       Decide unit / integration / E2E / manual QA. E2E is never
    strategy      auto-installed; if it is appropriate but unavailable the user
                  must explicitly decide to proceed without it
  → Test cases    Generate copy-pasteable test cases before any code is written
  → Confirmation  Explicit user confirmation of the testing approach and cases
  → Approval      Contract / plan (and, if flagged, architecture) gates
  → Implement     Only now can application code be mutated
  → Test          Validate that the claimed test files actually exist and run
    execution     them; report real results
  → Regression    Analyze blast radius, generate REG scenarios, require
                  current-run evidence (automated and/or user-confirmed manual)
  → Verify        AC → implementation + test + execution evidence chain
  → Review        →  Deliver  →  Completion report
```

The whole flow stays in the same conversation. The agent runs the `eos` commands
on your behalf; **you never have to run a CLI command to resume the workflow.**
Temporary run artifacts are cleaned automatically on successful completion, while
the durable delivery record and permanent project metadata are preserved.

## Add Engineering OS to your project (5 steps)

**Step 1 — Install the `eos` CLI once (from this repo):**

```bash
git clone https://github.com/AlpeshB08/engineering-os
cd engineering-os && npm install && npm link   # exposes `eos` globally
```

**Step 2 — Initialize it inside your project:**

```bash
cd /path/to/your-app
eos init      # creates .engineering-os/ and updates .gitignore
eos detect    # detects your stack and writes the Repository Profile
```

**Step 3 — Connect your AI assistant.** Copy the adapter for your tool into your
project (see [Adapters](#adapters)), e.g. for Claude Code copy
`adapters/claude-code/CLAUDE.md`. This tells the assistant to follow the active
`/feature` workflow and drive the `eos` commands for you.

**Step 4 — Start a feature.** In your AI chat, paste a Jira key, a Figma link, or
a plain description and ask it to run the `/feature` workflow. Under the hood it runs:

```bash
eos feature --jira PROJ-123 --figma <url> --context "what you want built"
```

**Step 5 — Answer in the chat and let it drive.** The workflow stays in one
conversation: the assistant asks questions, you answer, it re-analyzes and asks the
next one, then confirms the test strategy and test cases with you **before** writing
any code, implements, runs tests, does regression, and finishes with a delivery report.

> You never run these yourself — the assistant does — but under the hood each of your
> answers/approvals is one `eos feature continue` call in the same run:
> ```bash
> eos feature continue --answer "..."               # answer a clarification
> eos feature continue --confirm testing-strategy   # confirm the strategy
> eos feature continue --confirm test-cases         # confirm cases → implement
> eos feature continue --implemented --summary "..." --tests-created "path/to/test"
> eos feature continue --confirm regression
> eos feature continue --confirm review
> eos feature continue --confirm delivery
> ```

**Tip:** run `eos status` any time to see the current phase, pending questions, and
blockers. (Optional: `export ENGINEERING_OS_HOME=/path/to/engineering-os` if the CLI
can't locate the framework; for Cursor, install `.cursor/hooks.json` for hard mutation
guards — see [docs/installing-into-a-repo.md](docs/installing-into-a-repo.md).)

## Should this be published to npm?

**Not yet — `npm link` (or install-from-Git) is enough for now.** The `/feature`
workflow is still stabilizing, and both methods above already give you the global
`eos` command without publishing anything public.

Publish to npm later, once the workflow is stable and you want frictionless
installs across a team (`npm i -g engineering-os`, or `npx engineering-os`). When
that time comes it is a small step — there is no build, the CLI ships as source:

```bash
# one-time, when ready to release publicly
npm version patch
npm publish --access public
# if the name "engineering-os" is taken, publish under a scope, e.g. @alpeshb08/engineering-os
```

Until then, teammates install exactly as in Step 1 above.

## CLI (`eos`)

| Command | Purpose |
|---------|---------|
| `eos init` | Scaffold `.engineering-os/` in the current repo |
| `eos detect` | Detect capabilities and refresh the Repository Profile |
| `eos feature [--jira …] [--figma …] [--context …]` | Start the `/feature` workflow with structured intake |
| `eos feature continue …` | Advance the active run in the same conversation (answers, confirmations, implementation evidence) |
| `eos status` | Show phase, gates, pending decisions, blockers |
| `eos next` | Print AI-readable instructions for the current phase |
| `eos decision list \| answer <id> --option <id>` | Inspect / answer a workflow decision |
| `eos gate <id> --approve \| --reject` | Low-level approval primitive (the conversation drives these for you) |
| `eos guard implementation [--path <file>]` | Check whether application mutation is authorized |
| `eos verify run \| report` | Execute capability-gated checks / final readiness report |
| `eos cleanup [--dry-run] [--run <id>]` | Safely remove finalized run-owned temporary artifacts |
| `eos validate [--framework]` | Validate workflow, state, and schemas |

Intelligence helpers (`eos intel scan|graphs|impact|reuse|change-impact|jira|figma|verify-matrix|backend|test-strategy`), `eos context`, and `eos knowledge …` support the workflow. Run `eos help` for the full list.

## Repository layout

```
engineering-os/
├── docs/               # Framework documentation
├── engine/             # CLI, schemas, and tests
├── workflows/          # The feature-development workflow definition
├── phases/             # Shared phase instructions
├── templates/          # Artifact templates
├── standards/          # Enforceable engineering standards
├── checklists/         # QA and regression checklists
├── knowledge-base/     # Patterns, anti-patterns, ADRs, playbooks
└── adapters/           # Cursor, Claude Code, Copilot, Generic
```

## Adapters

| Tool | Path |
|------|------|
| Cursor | [adapters/cursor](adapters/cursor) |
| Claude Code | [adapters/claude-code](adapters/claude-code) |
| GitHub Copilot | [adapters/copilot](adapters/copilot) |
| Generic (Cline, Roo, Windsurf, …) | [adapters/generic](adapters/generic) |

Adapters never embed workflow logic. They instruct agents to run `eos status` /
`eos next`, present questions and approvals in chat, fill templates, and stop at gates.

## Documentation

- [Getting started](docs/getting-started.md)
- [Architecture](docs/architecture.md)
- [Concepts](docs/concepts.md)
- [Installing into a repo](docs/installing-into-a-repo.md)
- [Engineering Intelligence](docs/intelligence.md)
- [Mutation enforcement](docs/mutation-enforcement.md)
- [Feature Development workflow](docs/workflows/feature-development.md)
- [Feature Development walkthrough](docs/workflows/feature-development-walkthrough.md)

## Consumer state

After `eos init`, the target repo contains:

```
.engineering-os/
├── state.json
├── repository-profile.md
├── artifacts/<run-id>/     # cleaned automatically after successful delivery
└── knowledge-base/          # optional overlay
```

## License

MIT — see [LICENSE](LICENSE).
