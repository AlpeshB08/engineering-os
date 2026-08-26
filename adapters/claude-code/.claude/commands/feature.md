# /feature

Start and continue the Engineering OS feature workflow **in this same chat**.

The user must never be asked to run EOS commands to answer questions, approve a plan, or resume the run. Every question and confirmation is presented **inline, as an interactive prompt in this same conversation** — never as a "go type confirm" hand-off that ends the flow.

Parse Jira, Figma, and/or a plain task description from the user's message. Jira is optional. From the repository root:

```bash
eos feature --jira "<key-or-url>" [--figma "<url>"] [--context "<notes>"]
eos feature --figma "<url>"
eos feature --context "<plain task description>"
```

## Present every decision as an interactive in-chat prompt

Whenever the `EOS_FEATURE_TURN` payload has `awaiting: "user"`, do **not** end your
message with "reply confirm." Instead, present the decision using the
**AskUserQuestion tool** so the user answers with a click, inline, without leaving
the current conversation. Then immediately feed their choice back into the same run
and present the next turn the same way. This makes the whole workflow one
continuous, in-chat loop.

Map each `awaiting_kind` to an interactive prompt:

- **`questions` (clarification, choice)** — offer the decision's options as choices.
  On answer: `eos feature continue --decision "<id>" --option "<optionId>"`.
- **`questions` (clarification, free_text)** — ask the question via AskUserQuestion;
  the user types their answer in the "Other" field. On answer:
  `eos feature continue --decision "<id>" --answer "<their text>"`.
- **`testing_strategy`** — show the proposed strategy, then a prompt with
  **Confirm** / **Request changes**. On Confirm: `eos feature continue --confirm testing-strategy`.
- **`test_cases`** — show the copy-pasteable cases, then **Confirm** / **Request changes**.
  On Confirm: `eos feature continue --confirm test-cases`.
- **`manual_qa`** — **I ran these / Confirm** / **Not yet**. On confirm: `eos feature continue --confirm manual-qa`.
- **`regression`** — **Confirm** / **Request changes**. On confirm: `eos feature continue --confirm regression`.
- **`review`** — **Confirm review** / **Request changes**. On confirm: `eos feature continue --confirm review`.
- **`delivery`** — **Sign off delivery** / **Hold**. On confirm: `eos feature continue --confirm delivery`.

If the user picks "Request changes" / "Hold" / "Not yet", ask what they want changed
(inline), apply it, and re-present the updated prompt — still in this same run. Never
auto-answer, never auto-approve, never assume missing information.

After each answer the engine re-analyzes and may surface a newly discovered question.
Present it immediately as the next interactive prompt before proceeding.

## Implementation and the rest of the run

Implementation is allowed only when `implementation_permitted` is true. Then implement, create automated tests, run them, and submit evidence:

```bash
eos feature continue --implemented --summary "what changed" --tests-created "path/to/test.js"
```

`--implemented` does not complete verify, review, or delivery. Keep driving the
interactive loop above for manual QA, regression, review, and delivery. Use
`eos feature continue` (no flag) to refresh verification after real evidence is recorded.

After successful delivery, present the completion report. Do not say there is no active feature run.

## Rules that never change

- Do not install or configure an E2E framework. If E2E is appropriate but unavailable, present the explicit "proceed without E2E" decision as an interactive prompt and wait for the user's choice.
- If Jira/Figma discovery is incomplete, fetch via MCP in this chat and ingest with `eos intel jira|figma --from-json`. Do not ask the user to run CLI commands.
- Never claim E2E availability or test passage unless it was actually detected/executed.
- The interactive prompt still waits for the user's decision — it never proceeds to code changes without an explicit confirmation. It only changes *how* the question is presented (inline and clickable), not *whether* the user must decide.

> Note: the inline clickable prompt uses Claude Code's question tool. In editors
> without it, present the same options as a short numbered list in this chat and
> continue on the user's reply — still the same run, never a separate command.
