# Workflow: Feature Development

**ID:** `feature-development`

## Purpose

Deliver a feature from discovery through delivery preparation with contracts, intelligence-backed plans, gates, and verification.

## Phase sequence

bootstrap → discover → contract → plan → approve → implement → verify → review → deliver

## Primary entry: same-chat `/feature`

```bash
eos feature --jira PROJ-123 [--figma URL] [--context "..."]
eos feature --figma URL [--context "..."]
eos feature --context "plain task description"
```

This starts intake and analysis, then returns an `EOS_FEATURE_TURN` for the **same conversation**. The user answers in chat. The agent continues the same run:

```bash
eos feature continue --answer "<user reply>"
eos feature continue --confirm testing-strategy
eos feature continue --confirm test-cases
eos feature continue --implemented --summary "..." --tests-created "..."
eos feature continue --confirm regression
eos feature continue --confirm review
eos feature continue --confirm delivery
```

Do not ask the user to run `eos gate` or `eos decision answer` to continue `/feature`. Required approvals are recorded from explicit conversational confirmation. Application mutation stays blocked until those gates are satisfied. `--implemented` records implementation evidence only; it cannot skip verify → review → deliver.

Jira is not required. Figma-only and task-description intake are valid; the engine builds a contract from available information and asks in the same chat when acceptance criteria or scope are insufficient. It never invents requirements.

After successful delivery and cleanup, `/feature` renders a durable completion report (implementation, tests, regression, verification, review, delivery, cleanup). It does not finish with “No active feature run.”

Lifecycle: intake → clarification → testing strategy → test cases → implement → regression → verify → review → deliver.


## Key artifacts

- Repository Profile / Project DNA
- Discovery notes (Jira + optional Figma sections)
- Feature Contract
- Feature Impact / Reuse Analysis / Backend Dependency
- Implementation Plan / Verification Plan (strategy, scenarios, matrix)
- Verification evidence (execution vs scenarios separated)
- Review notes / Delivery Preparation

## Gates

- `contract-approval` after contract phase
- `architecture-approval` when architectural impact is flagged
- **`plan-approval`** on approve phase (mandatory before implement)
- `delivery-signoff` before closing the run

## Intelligence during plan

The pipeline runs plan intelligence automatically. Manual commands are thin wrappers:

```bash
eos feature orchestrate-plan   # same step functions as pipeline
eos intel jira --from-json …   # agent ingest + pipeline resume
eos intel figma --from-json …  # agent ingest + pipeline resume
```

Individual commands (only if orchestration blocked):

```bash
eos intel impact
eos intel reuse "<need>"
eos intel backend
eos intel test-strategy
eos intel verify-matrix
```

## Verification

```bash
eos verify run      # capability-gated engineering checks → evidence
eos verify report   # READY FOR REVIEW | NOT READY | BLOCKED
```

Final status is evidence-driven — not granted when an evidence section merely exists.
The verify phase cannot be completed until the current run reports `READY FOR REVIEW`.
After review, delivery preparation, and run-bound `delivery-signoff`, completing the
deliver phase automatically cleans temporary feature artifacts. Blocked, failed, and
verification-incomplete runs remain available for inspection and manual cleanup.

## Integrations

- [Jira (hybrid REST + agent)](../integrations/jira.md)
- [Figma (agent discovery)](../integrations/figma.md)

## Legacy start (without intake)

```bash
eos start feature-development
```

## Walkthrough

See [feature-development-walkthrough.md](feature-development-walkthrough.md).
