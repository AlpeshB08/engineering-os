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

## Agent protocol (same conversation)

1. Parse Jira, Figma, and/or a plain task description from the user's message. Jira is optional.
2. From the consumer repository root, run one of:

```bash
eos feature --jira "PROJ-123" --figma "https://figma.com/..." --context "optional notes"
eos feature --figma "https://figma.com/..."
eos feature --context "plain task description"
```

3. Read `EOS_FEATURE_TURN` (and `EOS_GUARD_MANIFEST`).
4. Present `message` to the user in this chat.
5. **Stop and wait** for the user's reply. Do not auto-answer, auto-approve, or assume missing requirements.
6. When the user replies, continue the **same run**:

```bash
eos feature continue --answer "<their reply>"
```

7. Repeat steps 3–6. After each answer the engine re-analyzes. If a new required question appears, ask it before implementation.
8. When the turn `stage` is `testing_strategy` and no questions remain, present the strategy and wait for explicit **confirm**.
9. When the turn `stage` is `test_cases`, present the copy-pasteable cases and wait for explicit **confirm**.
10. Implementation is allowed only when `implementation_permitted` is true.
11. Implement, create automated tests, and run available automated tests. Then submit evidence (this does **not** complete verify/review/deliver):

```bash
eos feature continue --implemented --summary "what changed" --tests-created "path/to/test.js"
```

12. If the turn asks for regression confirmation, present the cases and wait. Then `eos feature continue --confirm regression`.
13. If verification is not READY, fill current-run evidence from actual files and executed tests, then `eos feature continue` to refresh. Do not skip phases.
14. When verification is READY FOR REVIEW, wait for explicit review confirmation: `eos feature continue --confirm review`.
15. When review is complete, wait for explicit delivery confirmation: `eos feature continue --confirm delivery`.
16. After successful delivery, present the completion report from the turn. Do **not** tell the user there is no active feature run.

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
