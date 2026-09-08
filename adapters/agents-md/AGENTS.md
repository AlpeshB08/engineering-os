# AGENTS.md — Engineering OS `/feature`

This repository uses **Engineering OS**. Any coding agent working here must follow the
`/feature` workflow below and drive it with the `eos` CLI. Do not invent your own process.

## The workflow (one continuous chat, one run)

1. **Intake** — accept a Jira key, a Figma URL, a plain task description, or any combination:
   `eos feature --jira "KEY" --figma "URL" --context "notes"`
2. **Analyse first** — requirements, existing code, dependencies, risks, acceptance criteria,
   affected areas, constraints, missing information. Do not modify application code yet.
3. **Clarify recursively** — read `EOS_FEATURE_TURN`. While `awaiting: "user"`, present **one**
   question at a time in this chat and wait. After each answer the engine re-analyses; if a new
   question appears, ask it before proceeding.
   `eos feature continue --answer "<reply>"` / `--decision <id> --option <optionId>`
4. **Testing strategy** — present the proposed unit/integration/E2E/manual mix and get an explicit
   confirmation: `eos feature continue --confirm testing-strategy`.
   Never install or configure an E2E framework. If E2E fits but is absent, ask the user whether to
   proceed without it and wait for their decision.
5. **Test cases before code** — when `stage` is `test_cases`, paste the turn's `message` **verbatim**
   into the chat. It is the complete copy-pasteable case list (happy path, negative, edge, error) and
   must be shown before any code changes. Then `eos feature continue --confirm test-cases`.
6. **Implement** — only once `implementation_permitted` is true. Write the feature **and** the real
   automated test files for the confirmed cases.
7. **Run the tests through EOS** —
   `eos feature continue --implemented --summary "..." --tests-created "a.test.ts,b.test.ts"`.
   EOS executes the project's real lint/test/build and returns actual results; present them.
8. **Regression** — present the turn's regression `message` verbatim (impact map + copy-pasteable
   regression cases), then `eos feature continue --confirm manual-qa` / `--confirm regression`.
9. **Verify → review → deliver** — `eos feature continue` to refresh verification, then
   `--confirm review`, then `--confirm delivery`. Present the completion report.

## Hard rules

- **Never** run `npm` / `npx` / `tsc` / `vitest` / build commands yourself. The mutation guard blocks
  opaque tooling by design; `eos feature continue --implemented` runs them for you and reports real
  results. Never tell the user to run tests or the build manually.
- **Never** auto-answer, auto-approve, assume a missing requirement, or silently pick an option.
- **Never** claim a test was created, executed, or passed unless it actually was.
- **Never** stop at "implementation complete" or replace the EOS turns with your own summary. The run
  is finished only after regression is confirmed and delivery is signed off.
- **Never** modify application code while `implementation_permitted` is false; planning writes stay
  under `.engineering-os/**`.
- **Never** ask the user to run `eos gate`, `eos decision answer`, or `eos complete-phase` to continue.
- `--force` cannot bypass any gate.

## Artifacts

`.engineering-os/` is local, regenerable workflow state and is gitignored — do not commit it. Commit
your agent config (this file, `.cursor/`, `.claude/`) instead. Temporary run artifacts are cleaned
automatically after a successful delivery; the delivery record is the durable output.

## Useful commands

`eos status` · `eos next` · `eos guard implementation` · `eos verify report` · `eos intel reuse <q>`
