# Feature Development Walkthrough

This walkthrough uses a fictional frontend SPA (see `examples/frontend-spa`) to show how Engineering OS orchestrates a feature end-to-end.

## 0. Setup

```bash
export ENGINEERING_OS_HOME=/path/to/engineering-os
cd /path/to/your-app
npm link engineering-os   # or use node $ENGINEERING_OS_HOME/engine/src/cli.js
eos init
eos detect
```

Install an adapter (Generic shown):

```bash
cp $ENGINEERING_OS_HOME/adapters/generic/AGENTS.md .
cp $ENGINEERING_OS_HOME/adapters/generic/ENGINEERING_OS.md .
```

## 1. Start the workflow

```bash
eos feature --jira PROJ-123 --context "Add organization export to dashboard"
eos next
```

Or legacy start:

```bash
eos start feature-development
eos next
```

**Phase: bootstrap** — profile already exists from `eos detect`. Complete the phase:

```bash
eos complete-phase
```

## 1b. Optional first-run bootstrap

For a greenfield Engineering OS install on a repo, prefer:

```bash
eos start repository-bootstrap
```

Or quickly:

```bash
eos intel scan
eos intel graphs
```

## 2. Discover

Agent reads the repository, cites paths, and fills `discovery-notes.md`.

```bash
eos mark-artifact discovery-notes ready
eos complete-phase
```

## 3. Contract

Draft the Feature Contract. Human reviews scope.

```bash
eos mark-artifact feature-contract ready-for-approval
eos gate contract-approval --approve
eos complete-phase
```

## 4. Plan

Produce Feature Impact, Reuse Analysis, Implementation Plan, Backend Dependency, and Verification Plan (with matrix).

```bash
eos intel impact
eos intel reuse "relevant UI or domain need"
eos mark-artifact feature-impact ready
eos mark-artifact reuse-analysis ready
```

Because this SPA is `api-client-only`, Backend Dependency records unknown/missing contracts and a stub strategy — **no invented endpoints**.

If the plan changes architecture:

```bash
eos set-flag architectural_impact true
eos gate architecture-approval --approve
```

```bash
eos mark-artifact implementation-plan ready-for-approval
eos mark-artifact verification-plan ready
eos mark-artifact backend-dependency ready
eos complete-phase
```

## 5. Approve

Confirm gates are clear via `eos status`, then:

```bash
eos complete-phase
```

## 6. Implement

Agent implements only the approved plan, reusing existing UI/store patterns.

```bash
eos complete-phase
```

## 7. Verify

Run capability-gated checks; record evidence.

```bash
eos mark-artifact verification-evidence executed
eos complete-phase
```

## 8. Review

```bash
eos mark-artifact review-notes complete
eos complete-phase
```

## 9. Deliver

```bash
eos mark-artifact delivery-preparation ready-for-signoff
eos gate delivery-signoff --approve
eos complete-phase
```

Workflow status becomes `completed`.

## What the engine enforced

| Control | Effect |
|---------|--------|
| Artifacts | Phases cannot complete while required docs stay `draft` |
| Gates | Implementation/delivery blocked without human approval |
| Capabilities | Verification skips must cite missing tools |
| Backend | Frontend-only evidence prevents invented APIs |

## Next steps

- Try `eos start bug-fix` on a small defect
- Run `eos start repository-audit` for a read-only assessment
- Extend workflows via [extending-workflows.md](../extending-workflows.md)
