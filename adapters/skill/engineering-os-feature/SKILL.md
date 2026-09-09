---
name: engineering-os-feature
description: Run the Engineering OS /feature workflow — turn a Jira ticket, Figma link or task description into an implemented, tested feature with clarification questions, a confirmed test-case list before any code, real executed tests, and a copy-pasteable regression suite. Use whenever the user pastes a ticket or Figma link, or asks to build or fix a feature end-to-end.
---

# Engineering OS `/feature`

Drive the whole workflow with the `eos` CLI in one continuous conversation. Never invent your
own process, and never ask the user to run a CLI command to continue.

## Start

```bash
eos feature --jira "KEY" --figma "URL" --context "plain description"
```

Read the `EOS_FEATURE_TURN` JSON the command prints. It carries `stage`, `awaiting`,
`awaiting_kind`, `message`, and `implementation_permitted`. The `message` is written for the
user — present it in chat.

## Loop

While `awaiting: "user"`, present the decision **interactively** (use the host's ask-question /
options prompt if it has one; otherwise a short numbered list) and continue the same run:

| stage | what to show | command on confirm |
|---|---|---|
| `clarification` | one question at a time | `eos feature continue --answer "<reply>"` or `--decision <id> --option <optionId>` |
| `testing_strategy` | proposed unit/E2E/manual mix | `eos feature continue --confirm testing-strategy` |
| `test_cases` | **paste `message` verbatim** — the full copy-pasteable case list | `eos feature continue --confirm test-cases` |
| `manual_qa` | manual QA cases | `eos feature continue --confirm manual-qa` |
| `regression` | **paste `message` verbatim** — impact map + regression cases | `eos feature continue --confirm regression` |
| `verify` | verification status | `eos feature continue --confirm review` |
| `review` / `deliver` | review + delivery summary | `eos feature continue --confirm delivery` |

After each answer the engine re-analyses and may surface a newly discovered question — ask it
before moving on.

## Implement

Only when `implementation_permitted` is true. Write the feature **and** the real test files for
the confirmed cases, then:

```bash
eos feature continue --implemented --summary "what changed" --tests-created "a.test.ts,b.test.ts"
```

EOS runs the project's real lint/test/build itself and returns actual results. Present them.

## Never
- **Never end a turn by asking whether to continue.** "Would you like me to continue through regression / review / delivery?" is not a decision the user has to make — it is the workflow. Drive straight on to the next stage and only stop when the turn genuinely awaits a user decision (a clarification, or an explicit confirmation the engine is asking for).
- **Never confirm a stage you did not show.** Do not run `--confirm test-cases` or `--confirm regression` unless you first presented that turn's `message` in the chat. If the suite is large the turn returns a summary plus a path to the full list — present that verbatim.


- **Never run** `npm` / `npx` / `tsc` / `vitest` / build commands yourself, or tell the user to run them.
- Auto-answer, auto-approve, or assume a missing requirement.
- Claim a test was created, executed or passed unless it was.
- Stop at "implementation complete", or replace the EOS turns with your own summary.
- Modify application code while `implementation_permitted` is false.

- **Intake text with backticks or `$( )` must go through a file.** Ticket and Figma descriptions routinely contain them, and the mutation guard correctly refuses an inline argument the shell would execute. Write the text to `.engineering-os/intake.md` (writable during planning) and run `eos feature --context-file .engineering-os/intake.md`. Never strip the characters out of the requirement to make it fit on the command line.
