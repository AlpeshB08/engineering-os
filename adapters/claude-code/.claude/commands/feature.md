# /feature

Start and continue the Engineering OS feature workflow **in this same chat**.

The user must never be asked to run EOS commands to answer questions, approve a plan, or resume the run.

Parse Jira, Figma, and/or a plain task description from the user's message. Jira is optional. From the repository root:

```bash
eos feature --jira "<key-or-url>" [--figma "<url>"] [--context "<notes>"]
eos feature --figma "<url>"
eos feature --context "<plain task description>"
```

Present the `EOS_FEATURE_TURN` message in this chat. Wait for the user's reply. Then:

```bash
eos feature continue --answer "<their reply>"
```

After each answer the engine re-analyzes. Ask newly discovered questions before implementation.

When testing strategy or test cases are presented, wait for explicit **confirm**. Never auto-approve.

Do not install or configure an E2E framework. If E2E is appropriate but unavailable, wait for an explicit user decision to proceed without E2E.

Implementation is allowed only when `implementation_permitted` is true. Then implement, create automated tests, run them, and submit evidence:

```bash
eos feature continue --implemented --summary "what changed" --tests-created "path/to/test.js"
```

`--implemented` does not complete verify, review, or delivery. Continue in this chat:

- `--confirm regression` when manual regression is required
- `eos feature continue` to refresh verification after real evidence is recorded
- `--confirm review` when verification is READY FOR REVIEW
- `--confirm delivery` after review

After successful delivery, present the completion report. Do not say there is no active feature run.

If Jira/Figma discovery is incomplete, fetch via MCP in this chat and ingest with `eos intel jira|figma --from-json`. Do not ask the user to run CLI commands.

Never claim E2E availability or test passage unless it was actually detected/executed.
