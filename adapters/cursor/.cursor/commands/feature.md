# /feature

Start and continue the Engineering OS feature workflow **in this same chat**.

The user must never be asked to run EOS commands to answer questions, approve a plan, or resume the run.

## Usage

```
/feature

Jira: PROJ-123
Figma: https://figma.com/design/...
Additional context: optional notes
```

## Present every decision with Cursor's ask-question tool

Whenever a `/feature` turn needs a user decision (`awaiting: "user"` — clarifications,
testing strategy, test cases, manual QA, regression, review, delivery), **use the ask
question tool** to present it as an interactive prompt with clickable options, right in
this conversation. Do **not** end your turn with a plaintext "reply confirm" — that is
the behavior we are replacing.

- The ask-question tool is Cursor's built-in interactive Q&A (the one used in Plan/Debug
  mode). Requires Cursor 2.4+. If it is unavailable in your build/mode, and only then,
  fall back to a short numbered options list the user answers inline.
- Present the decision's options as the choices (e.g. **Confirm** / **Request changes**,
  or the decision's own option labels). When the user picks an option, immediately map it
  to the matching `eos feature continue …` on the same run and present the next turn the
  same way. This keeps the workflow one continuous, in-chat loop with no dead-end.
- If the user picks "Request changes" (or similar), ask what to change via the same tool,
  apply it, and re-present the updated prompt. Never auto-answer, auto-approve, assume
  missing requirements, or tell the user to run a command / start over to continue.

## Agent protocol (same conversation)

1. Parse Jira, Figma, and/or a plain task description from the user's message. Jira is optional.
2. From the consumer repository root, run one of:

```bash
eos feature --jira "PROJ-123" --figma "https://figma.com/..." --context "optional notes"
eos feature --figma "https://figma.com/..."
eos feature --context "plain task description"
```

3. Read `EOS_FEATURE_TURN` (and `EOS_GUARD_MANIFEST`).
4. If `awaiting: "user"`, present `message` and its options **using the ask question tool** (see above). Never frame it as a dead-end "reply confirm to continue" hand-off.
5. On the user's choice, continue the **same run** — do not auto-answer, auto-approve, or assume missing requirements:

```bash
eos feature continue --answer "<their reply>"
# or, for a decision with options:  eos feature continue --decision "<id>" --option "<optionId>"
```

6. Repeat steps 3–5. After each answer the engine re-analyzes. If a new required question appears, ask it (via the ask question tool) before implementation.
7. When the turn `stage` is `testing_strategy` and no questions remain, present the strategy via the ask question tool with **Confirm** / **Request changes**. On Confirm: `eos feature continue --confirm testing-strategy`.
8. When the turn `stage` is `test_cases`, **paste the turn's `message` verbatim into chat** — it is the full copy-pasteable list of unit/e2e/manual test cases and must be shown to the user before any code changes. Then ask **Confirm** / **Request changes** via the tool. On Confirm: `eos feature continue --confirm test-cases`.
9. Implementation is allowed only when `implementation_permitted` is true (this is what step 8's confirm unlocks).
10. Now implement the feature **and write the real automated test files** for the confirmed test cases (test files are application paths and are writable during implement). Then submit evidence — **EOS runs the tests for you**:

```bash
eos feature continue --implemented --summary "what changed" --tests-created "path/to/one.test.ts,path/to/two.test.ts"
```

`eos feature continue --implemented` executes the project's real lint/test/build itself and returns actual pass/fail in the next turn. Present those results in chat.

11. Continue the loop for **manual QA** and **regression**: for each, **paste the turn's `message` verbatim** (it contains the copy-pasteable manual-QA and regression test cases), present **Confirm** / **Request changes** via the ask question tool, then `eos feature continue --confirm manual-qa` / `--confirm regression`.
12. If verification is not READY, add the missing current-run evidence (write/fix the test files named in the turn) and run `eos feature continue` to refresh. Do not skip phases.
13. When verification is READY FOR REVIEW, ask for review confirmation via the tool: `eos feature continue --confirm review`.
14. When review is complete, ask for delivery confirmation via the tool: `eos feature continue --confirm delivery`.
15. After successful delivery, present the completion report from the turn. Do **not** tell the user there is no active feature run.

## Tests & regression — do NOT skip or free-style

- **Never run `npm`/`npx`/`tsc`/`vitest`/`jest`/build commands yourself.** The EOS guard blocks opaque build/test tooling by design and that is expected — it is **not** a reason to skip tests. `eos feature continue --implemented` runs the real lint/test/build inside EOS (a trusted subprocess) and reports actual results. Delegate to it.
- **Never tell the user to run `tsc` / `npm run build` / tests manually.** If you think tests didn't run, you skipped `eos feature continue --implemented` — run it.
- **Always surface the test cases and regression cases in chat**, copy-pasteable, from the `test_cases` and `regression` turn `message`s. The workflow is not done until the regression cases have been shown and confirmed.
- **Do not write your own "implementation complete" summary** in place of the EOS turns. Drive `--implemented` → manual-qa → regression → review → delivery and present each turn's `message`. A summary that ends at "implementation complete, run the tests yourself" means the workflow was abandoned early.
- If your editor blocks creating `*.test.*` files (e.g. a `.cursorignore` / `files.exclude` rule), tell the user that specific rule is blocking test creation and ask them to allow the test path — do not silently skip writing tests.

The confirmation gate is unchanged: the tool still waits for an explicit user decision before any code changes — only the presentation changes (an interactive prompt instead of a typed "confirm").

## Discovery the agent must do (not the user)

If the turn `awaiting` is `agent` for Jira/Figma:

- Fetch via REST/MCP in this chat.
- Ingest with `eos intel jira --from-json` / `eos intel figma --from-json`.
- Continue automatically. Do not ask the user to run those commands.

## Hard rules

- Never auto-answer a question or auto-approve a decision.
- Never install or configure an E2E framework.
- Never claim E2E is available or executed unless the turn says it is.
- Never mutate application code while `implementation_permitted` is false. Planning writes stay under `.engineering-os/**`.
- `--force` cannot bypass required questions, testing confirmation, or implementation gates.
- `--implemented` submits implementation evidence only. It cannot mark verify, review, or deliver complete.
- Do not tell the user to run `eos decision answer`, `eos gate`, or `eos complete-phase` to continue `/feature`.
