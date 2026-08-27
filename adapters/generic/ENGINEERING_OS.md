# Engineering OS — Agent Operating Manual

You are operating inside a repository that uses **Engineering OS**, an AI-agnostic workflow framework.

## Mandatory loop

1. Run `eos status` (or read `.engineering-os/state.json`).
2. Run `eos next` and follow the phase instructions exactly.
3. Fill required artifacts under `.engineering-os/artifacts/<run-id>/`.
4. When an artifact is ready, set `<!-- EOS_ARTIFACT_STATUS: ready-for-approval -->` (or `ready` / `executed` / `complete` as appropriate) or run `eos mark-artifact <id> <status>`.
5. Stop for human gates. Never bypass `contract-approval`, `architecture-approval`, or `delivery-signoff`.
6. When `run.workflow_decisions` has pending items — or the turn awaits a testing-strategy / test-cases / regression / review / delivery confirmation — present it in this chat as a **continuing prompt**: end with the available options as a short numbered list (the decision's choices, or `1. Confirm  2. Request changes`) so the user answers inline, and continue the same run with `eos feature continue --answer "…"` / `--decision … --option …` / `--confirm …`. Keep it one conversation — never frame it as a dead-end "reply confirm to continue" hand-off or tell the user to start over. Never infer defaults — missing, timed-out, or cancelled input remains pending.
7. Do not ask the user to run `eos complete-phase` to continue `/feature`. Conversational confirmations record required approvals and then use the same `complete-phase` transitions. `--implemented` is evidence submission, not completion.
8. **Application mutation guard:** while EOS is initialized, mutate application/production files only when `eos guard implementation --json` reports `implementation_permitted: true`. During planning, allowed write scope is `.engineering-os/**` only. Adapters must install fail-closed hooks (`eos guard hook`) for file, shell, and MCP mutation paths — the engine is the source of truth; adapters must not implement separate decision logic.

## Principles

- Discover before implementing.
- Reuse before creating.
- Repository-first, AI-second.
- Never assume missing systems (especially backend).
- Never modify architecture without approval.
- Generate evidence, not assumptions.
- Verification is mandatory before delivery.

## Tests & regression (do not skip or free-style)

- Present the **test cases** in chat (copy-pasteable) from the `test_cases` turn `message` **before** any code changes; confirm, then `eos feature continue --confirm test-cases`.
- During implement, **write the real test files**, then run `eos feature continue --implemented --summary "…" --tests-created "a.test.ts,b.test.ts"`. **EOS runs the project's real lint/test/build itself** and returns actual results — **never run `npm`/`npx`/`tsc`/`vitest`/build yourself** (the guard blocks opaque tooling by design) and **never tell the user to run tests manually**.
- After implementation, present the **regression test cases** in chat (copy-pasteable) from the `regression` turn `message`, confirm, then `eos feature continue --confirm regression`. Keep driving review → delivery.
- Do not replace these turns with your own "implementation complete" summary. The run is done only after regression is confirmed and delivery signs off.

## Forbidden

- Inventing backend APIs or schemas
- Skipping workflow phases to “just code”
- Running build/test tooling yourself instead of delegating to `eos feature continue --implemented`
- Telling the user to run tests/build manually, or ending at "implementation complete"
- Claiming tests/lint ran without evidence
- Expanding scope beyond the Feature Contract

## Phase 2 — Engineering Intelligence

Prefer these commands during discovery/planning:

1. `eos feature --jira …`, `eos feature --figma …`, or `eos feature --context "…"` to start with structured intake (or `eos start feature-development`)
2. `eos feature orchestrate-plan` for impact, reuse, backend, test strategy, and matrix
3. `eos intel jira` when Jira REST or MCP normalization is needed
4. `eos intel scan` / `eos intel graphs` for Project DNA when stale
5. `eos context` (also produced by `eos next`) instead of loading the whole repo
6. `eos verify run` / `eos verify report` during verify phase
7. `eos knowledge search "<topic>"` for lessons, ADRs, and patterns
8. Expanded Backend Dependency + Verification Matrix — never invent APIs
