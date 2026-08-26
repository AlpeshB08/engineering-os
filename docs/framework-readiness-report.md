# Engineering OS — Framework Readiness Report

- **Framework version:** 0.2.0 (`package.json`)
- **Assessment date:** 2026-08-07
- **Scope:** Production readiness of the Engineering OS repository (docs, CLI, workflows, templates, examples, intelligence layer, adapters)
- **Method:** Evidence-based review of repository contents and CLI/workflow definitions. Simulated executions are dry-runs (no application product code written).
- **Evidence labels:** **Verified** = confirmed in repo/CLI behavior; **Assumption** = inferred impact not proven by runtime execution in this assessment.

---

## Executive Summary

Engineering OS is a coherent, workflow-driven framework with a working Phase 1 orchestration loop and a substantial Phase 2 intelligence layer. `eos validate --framework` succeeds; seven workflows load; core commands (`init`, `detect`, `start`, `next`, `gate`, `complete-phase`, `mark-artifact`) and intelligence commands (`intel *`, `context`, `knowledge *`) are implemented and discoverable via `eos help`.

**Key strengths**

- Clear principles and gate model (contract / architecture / delivery).
- Declarative workflows + shared phases + artifact templates.
- Project DNA, graphs, impact, reuse, and context packs integrate into discover/plan guidance.
- Thin AI adapters (Cursor, Claude Code, Copilot, Generic) without forking workflow logic.
- Automated tests for detection and intelligence (`npm test`).

**Highest-priority issues**

1. Phase 2 verification-matrix and backend-contract helpers exist in code but are **not wired to the CLI** — incomplete integration of advertised intelligence.
2. Non–feature-development workflows lack step-by-step walkthroughs; first-time users beyond feature flow are under-served.
3. No FAQ / troubleshooting / onboarding checklist; getting-started leads with feature-development before repository-bootstrap.
4. Orphan/inconsistent templates (`repository-profile.md` unused generator path; `context-package.md` unused; `project-dna` map entry without template file).
5. Artifact “completeness” is status-marker shallow — empty verification matrices can be marked `ready`.

**Production readiness observation**

The framework is **usable for guided feature delivery with an attentive human + AI agent**, but **not yet production-ready as a self-serve engineering OS** until high-priority integration gaps, walkthroughs, and onboarding docs are closed. Treat current state as **beta / early production for opinionated teams**, not general rollout.

---

## 1. Complete

### Workflows (structure validated)

| Workflow | File | Status |
|----------|------|--------|
| `feature-development` | `workflows/feature-development.yaml` | Complete structure + detailed docs/walkthrough |
| `bug-fix` | `workflows/bug-fix.yaml` | Complete YAML; thin docs |
| `refactoring` | `workflows/refactoring.yaml` | Complete YAML; thin docs |
| `repository-audit` | `workflows/repository-audit.yaml` | Complete YAML; thin docs |
| `code-review` | `workflows/code-review.yaml` | Complete YAML; thin docs |
| `release-preparation` | `workflows/release-preparation.yaml` | Complete YAML; thin docs |
| `repository-bootstrap` | `workflows/repository-bootstrap.yaml` | Complete YAML + dedicated doc |

**Verified:** `eos validate --framework` OK; `eos workflows` lists all seven.

### CLI (implemented and listed in help)

Phase 1: `init`, `detect`, `start`, `status`, `next`, `gate`, `complete-phase`, `set-flag`, `abort-run`, `mark-artifact`, `validate`, `workflows`, `help`.

Intelligence: `intel scan|graphs|impact|reuse|change-impact`, `context`, `knowledge index|search|add`.

**Verified:** `engine/src/cli.js` switch cases match `eos help` surface.

### Templates referenced by workflows / seeding

Seeded or special-cased and used in practice:

- `discovery-notes`, `feature-contract`, `implementation-plan`, `verification-plan`, `backend-dependency`, `feature-impact`, `reuse-analysis`, `verification-evidence`, `review-notes`, `delivery-preparation`, `decision-log` (always seeded), `audit-report`, `report`
- `repository-profile` / `project-dna` as intelligence-root artifacts (generated, not seeded from run templates)

### Integrations

- Adapters: `adapters/cursor`, `adapters/claude-code`, `adapters/copilot`, `adapters/generic`
- Standards: `standards/*`
- Knowledge base categories + `eos knowledge index` (`knowledge-base/index.json`)
- Examples with intelligence snapshots: `examples/*/.engineering-os/intelligence/`

### Features validated as working end-to-end (smoke-tested in Phase 2)

- Project DNA generation (`eos intel scan`)
- Graphs (`eos intel graphs`)
- Feature impact + reuse ranking
- Context pack emission from `eos next` / `eos context`
- Gate blocking and phase advancement with artifact status markers

---

## 2. Partially Implemented

### 2.1 Verification matrix intelligence

- **Current state:** `engine/src/intelligence/verificationMatrix.js` exports `buildVerificationMatrixRows` / `renderMatrixMarkdown`; `templates/verification-plan.md` includes a matrix section; functions re-exported from `intelligence/index.js`.
- **Missing:** No CLI subcommand or plan-phase auto-fill calls these functions (**Verified:** no usages outside `index.js` exports).
- **Impact:** Agents must hand-author the matrix; Phase 2 “Verification Intelligence” is incomplete.

### 2.2 Backend contract helpers

- **Current state:** `engine/src/intelligence/backendContract.js` defines sections/rules helpers; expanded template exists.
- **Missing:** CLI never invokes helpers to scaffold/fill `backend-dependency.md`.
- **Impact:** Dead helper code; reliance on template prose only.

### 2.3 QA / regression checklists

- **Current state:** `checklists/qa/*`, `checklists/regression/*`; referenced from verification template and `knowledge-base/repo-archetypes/*`.
- **Missing:** Engine does not select or attach checklists by archetype; not exit criteria.
- **Impact:** Soft guidance; easy to skip in verify/release.

### 2.4 Decision log

- **Current state:** Always seeded (`artifacts.js` `seedRunArtifacts` adds `decision-log`).
- **Missing:** Never listed in any workflow `required_artifacts`.
- **Impact:** Living doc often ignored; architectural decisions may not be recorded.

### 2.5 Non-feature workflow documentation

- **Current state:** Short pages under `docs/workflows/{bug-fix,refactoring,repository-audit,code-review,release-preparation}.md`.
- **Missing:** Step-by-step CLI walkthroughs comparable to `feature-development-walkthrough.md`.
- **Impact:** First-time users cannot reliably run secondary workflows without reverse-engineering YAML.

### 2.6 Examples

- **Current state:** Archetype folders with `.engineering-os/` + toy `src/` files; intelligence snapshots present.
- **Missing:** Realistic layouts (esp. `backend-api` still has FE-shaped `components/ui`); README framing still partially “init/detect snapshot.”
- **Impact:** Misleading onboarding demos (**Verified:** `examples/backend-api/src/components/ui/Button.tsx` exists).

### 2.7 Artifact completeness enforcement

- **Current state:** `artifactLooksComplete` checks `EOS_ARTIFACT_STATUS` ∈ {ready, ready-for-approval, approved, executed, complete, signed-off} (`artifacts.js`).
- **Missing:** No validation that verification matrix rows, reuse candidates, or backend sections are populated.
- **Impact:** Phases can advance with hollow artifacts.

### 2.8 Intelligence in secondary workflows

- **Current state:** Phase docs for audit/review/release mention DNA/graphs lightly or not at all; YAML does not require them.
- **Missing:** Hard wiring of `eos intel change-impact` / DNA into audit, code-review, release-preparation.
- **Impact:** Phase 2 value concentrated on feature/bug/refactor plan path only.

---

## 3. Unused

| Item | Why it appears unused | Evidence |
|------|----------------------|----------|
| `templates/repository-profile.md` | Profile content is generated by `detect.js` `renderRepositoryProfile`, not seeded from this template | `cli.js` `writeProfile`; template never read in engine |
| `templates/context-package.md` | Not in any workflow `required_artifacts`; `context.js` writes `context-package.md` directly | Grep of workflows; `context.js` write path |
| `ARTIFACT_TEMPLATE_MAP['project-dna']` → `project-dna.md` | No `templates/project-dna.md`; skipped via intel-root special case | Missing file; `INTEL_ROOT_ARTIFACTS` in `artifacts.js` |
| `verificationMatrix.js` / `backendContract.js` runtime path | Exported but never called from CLI | Grep shows only `index.js` re-exports |
| Framework-root `.engineering-os/` | Consumer residue inside the framework repo | Path present at repo root |
| `engine/fixtures/sample-state.json` | Not referenced by tests or CLI | No imports found (**Assumption:** leftover fixture) |

**Note:** `decision-log.md` is generated every run but weakly consumed — “underused,” not strictly unused.

---

## 4. Redundant

| Overlap | Recommendation |
|---------|----------------|
| `approve` phase vs gates on `contract` / `plan` / `implement` | Keep one explicit human-stop narrative: either lean on `approve` or on gate lists — document why both exist; consider making `approve` optional/no-op docs clearer |
| `report` vs `audit-report` | Keep both IDs but add a one-line “when to use which” in concepts; or converge on `report` with a type field |
| Implementation Plan reuse map vs `reuse-analysis.md` | Keep ranked analysis as source of truth; make Implementation Plan table a summary link only (already partially done) |
| Repository Profile vs Project DNA vs capability-matrix vs architecture-summary | Document a hierarchy: Profile (capabilities) → DNA (inventory) → summaries (bootstrap pack); avoid rewriting the same stack table four times |
| `docs/intelligence.md` vs `docs/phase-2-engineering-intelligence.md` | Keep intelligence.md as operator guide; phase-2 doc as historical closeout — cross-link roles clearly |
| Adapter READMEs vs `docs/adapters/*` | Fine for packaging; ensure docs/adapters remain the canonical install narrative |

---

## 5. Documentation Gaps

| Gap | Detail |
|-----|--------|
| No FAQ | Nowhere in `docs/` (**Verified:** no FAQ/troubleshoot matches) |
| No troubleshooting | Stuck gates, missing DNA, active-run conflicts, `--force` risks undocumented as a dedicated guide |
| No onboarding checklist | Getting-started is narrative, not a checklist of “day-0 done” |
| Missing walkthroughs | bug-fix, refactoring, repository-audit, code-review, release-preparation |
| Artifact lifecycle doc | No single producer/consumer map (this report section 8 should be promoted into standing docs later) |
| Mark-artifact statuses | Valid statuses live in code (`COMPLETE_STATUSES`); not listed in getting-started |
| First-run ordering | Getting-started leads with `feature-development`; bootstrap/intel path is appended |
| Examples honesty | Need clearer “illustrative stubs, not apps” callouts per example README (partially in `examples/README.md`) |

Broken relative links under `docs/`: **none found** in automated scan at assessment time (**Verified**).

---

## 6. Workflow Integration Gaps

### Missing connections

| Gap | Files / behavior |
|-----|------------------|
| Discover recommends DNA but only `repository-bootstrap` requires `project-dna` | `phases/discover.md` vs `workflows/*.yaml` |
| Graphs not enforced as exit criteria | `phases/intel-scan.md` prose vs no artifact ID for graphs |
| Audit phase `required_artifacts: []` | `workflows/repository-audit.yaml` — findings not captured until `report` |
| Code-review / release do not invoke change-impact / graphs | Docs + YAML |
| Delivery preparation on read-only bootstrap/audit | Required for sign-off but framing as “PR package” is confusing |
| Checklists not attached at verify/release | Templates mention paths; engine does not |

### Weak handoffs

- Feature Contract → `eos intel impact` (manual CLI; not automatic on entering plan).
- Reuse analysis → Implementation Plan (documented; not validated).
- Feature impact regression areas → Verification Plan matrix (prose only).
- Verification Plan → Verification Evidence (status only).

---

## 7. CLI Review

### Existing commands (purpose)

| Command | Purpose | Primary workflow use |
|---------|---------|----------------------|
| `eos init` | Scaffold `.engineering-os/` | All |
| `eos detect` | Capabilities + repository profile | Bootstrap |
| `eos start <wf>` | Begin run, seed artifacts | All |
| `eos status` | Phase/gates/artifacts | All |
| `eos next` | Phase instructions + context pack | All |
| `eos gate` | Human approval | Contract/plan/deliver |
| `eos complete-phase` | Advance state machine | All |
| `eos mark-artifact` | Status transition | All |
| `eos set-flag` | `architectural_impact` | Plan/refactor |
| `eos abort-run` | End active run | Switching workflows |
| `eos validate` | Framework/consumer checks | CI/dev |
| `eos workflows` | List IDs | Discovery |
| `eos intel scan` | Project DNA + summaries | Bootstrap/discover |
| `eos intel graphs` | Dependency graphs | Bootstrap/plan |
| `eos intel impact` | Feature impact artifact | Plan |
| `eos intel reuse` | Ranked reuse | Plan |
| `eos intel change-impact` | Blast radius | Review/refactor |
| `eos context` | Slim context pack | Any phase |
| `eos knowledge *` | Index/search/add KB | Discover/plan/review |

### Missing functionality (for existing design completeness)

- Wire verification matrix generator into CLI (e.g. fill `verification-plan.md` matrix section).
- Optional scaffold assist for backend-dependency from `backendContract.js`.
- `eos doctor` / first-run health check (**roadmap** — not present).
- Documented safe defaults for `complete-phase --force`.

### Inconsistencies

- `eos context` is top-level while other intelligence commands are under `eos intel`.
- Knowledge is a third top-level namespace (`eos knowledge`).
- Naming is generally consistent (`intel` verbs clear).

### Suggested improvements (no scope expansion beyond integration)

1. `eos intel verify-matrix` calling existing `verificationMatrix.js`.
2. Namespace `eos context` as `eos intel context` (keep alias for BC).
3. Warn loudly when `--force` bypasses gates.
4. `eos status` already shows DNA presence — extend to graphs present/absent.

---

## 8. Artifact Flow Review

### Run artifacts (`.engineering-os/artifacts/<run-id>/`)

| Artifact | Producer | Consumer | Lifecycle |
|----------|----------|----------|-----------|
| `discovery-notes.md` | Agent in discover; template seeded | Plan/contract humans & agents | Per run |
| `feature-contract.md` | Agent; gate `contract-approval` | Impact generator, implement | Per run |
| `feature-impact.md` | `eos intel impact` / agent | Plan, verify regression | Per run |
| `reuse-analysis.md` | `eos intel reuse` / agent | Implementation plan | Per run |
| `implementation-plan.md` | Agent | Approve/implement | Per run |
| `backend-dependency.md` | Agent (template) | Implement; human follow-ups | Per run |
| `verification-plan.md` | Agent (template; matrix unaided) | Verify phase | Per run |
| `verification-evidence.md` | Agent/human during verify | Delivery prep | Per run |
| `review-notes.md` | Agent in review | Deliver / humans | Per run |
| `delivery-preparation.md` | Agent; gate `delivery-signoff` | Close run | Per run |
| `decision-log.md` | Seeded always | Optional ADR promotion | Per run (underused) |
| `audit-report.md` | Agent in audit/report | Deliver | Audit runs |
| `report.md` | Agent in report | Bootstrap/code-review | Those workflows |
| `context-package.md` | `eos context` / `eos next` | Agents (pointer) | Regenerated |

### Intelligence-root artifacts (`.engineering-os/`)

| Artifact | Producer | Consumer | Lifecycle |
|----------|----------|----------|-----------|
| `repository-profile.md` | `eos init` / `eos detect` / scan side-effect | All phases, context pack | Refreshed |
| `intelligence/project-dna.{json,md}` | `eos intel scan` | Impact, reuse, graphs, context | Refreshed |
| `intelligence/capability-matrix.md` | scan | Bootstrap report | Refreshed |
| `intelligence/architecture-summary.md` | scan | Bootstrap report | Refreshed |
| `intelligence/reuse-inventory.md` | scan | Reuse/plan | Refreshed |
| `intelligence/known-risks.md` | scan | Bootstrap/audit | Refreshed |
| `intelligence/standards-summary.md` | scan | Bootstrap | Refreshed |
| `intelligence/graphs/*` | `eos intel graphs` | change-impact, regression | Refreshed |
| `intelligence/context/*` | `eos context` / `eos next` | Agents | Per phase |

### Orphaned / poorly documented handoffs

- Template `repository-profile.md` unused (generator wins).
- Template `context-package.md` unused (writer wins).
- Graphs have no artifact ID in workflow YAML — completion is honor-system.
- Verification matrix: producer missing (helpers unused).

---

## 9. Developer Experience Review

### Journey assessment

| Step | Experience | Friction |
|------|------------|----------|
| Install (`npm install` / `npm link`) | Straightforward | Need `ENGINEERING_OS_HOME` awareness when not linked from source |
| Initial setup (`eos init` / `detect`) | Clear | DNA/bootstrap not forced next |
| Understanding framework | Many docs (principles, concepts, intelligence, phase-2) | Concept sprawl; no single “map of the territory” |
| Running feature workflow | Best-supported path | Many `mark-artifact` + `complete-phase` steps |
| Bug fix / audit | YAML works | Missing walkthroughs |
| CLI | Discoverable via help | Three namespaces (`eos`, `intel`, `knowledge`, plus `context`) |
| Creating artifacts | Templates seed on start | Easy to mark ready without content |
| Completing feature | Walkthrough exists | Intelligence steps easy to skip if agent ignores `eos next` |
| Completing bug fix | Same plan burden as features | May feel heavy for tiny fixes (**Assumption**) |
| Running audit | Short path | Empty audit phase requirements; delivery-prep framing odd |

### Learning curve

Moderate-to-steep for first-time users: gates, status markers, DNA, context packs, and multiple overlapping “repo summary” docs. Feature walkthrough mitigates this for one path only.

### Repetitive steps

- `eos next` → edit → `mark-artifact` → `complete-phase` repeated per phase.
- Re-stating stack in profile + DNA + capability matrix + architecture summary during bootstrap.

### Areas of confusion

1. When is `repository-bootstrap` required vs optional `eos intel scan`?
2. Why does plan list `architecture-approval` gate if impact is false? (Engine filters it — behavior correct but surprising without docs.)
3. Why delivery-preparation on read-only workflows?
4. Examples that look like apps but are stubs.

---

## 10. Suggested Simplifications

1. **First-run default:** Document `eos start repository-bootstrap` as day-0; then feature-development.
2. **One “repo truth” ladder:** Profile (capabilities) → DNA (inventory) → optional bootstrap summaries; stop duplicating stack tables.
3. **Promote reuse-analysis** as the only detailed reuse artifact; keep Implementation Plan map as a short summary.
4. **Wire or remove** unused helpers (`verificationMatrix`, `backendContract`) — prefer wire (completes existing design).
5. **Delete or generate-from** orphan templates (`repository-profile` template; align `context-package` template with writer or drop it).
6. **Clarify `approve` phase** as a human ceremony checkpoint, not a second gate system.
7. **Add thin walkthrough stubs** (1 page each) for bug-fix and audit before any new features.
8. **FAQ page** covering the top five stuck states (active run, missing DNA, pending gate, incomplete artifact, `--force`).

Do **not** add new workflow types or a hosted service for readiness.

---

## 11. Phase 3 Roadmap

### High Priority

Required before calling the framework production-ready for general teams:

1. **Wire verification matrix generator** into CLI and plan/verify phase instructions (`verificationMatrix.js` → update `verification-plan.md`).
2. **Walkthroughs** for `bug-fix`, `refactoring`, and `repository-audit` (CLI + artifacts + gates).
3. **FAQ + troubleshooting** doc (gates, DNA, active-run, `--force`, mark-artifact statuses).
4. **Resolve orphan templates / map inconsistencies** (`repository-profile` template vs generator; `context-package` template; `project-dna` map entry).
5. **Reorder getting-started** to bootstrap → DNA → feature-development.
6. **Document artifact lifecycle** (promote Section 8 into standing `docs/artifacts.md`).

### Medium Priority

Strengthen usability and maintainability:

1. Attach archetype checklists automatically into verification/release context packs.
2. Require or strongly gate Project DNA on discover for feature/bug/refactor (or auto-run scan).
3. Enforce graphs generation in `intel-scan` exit criteria (artifact or file-existence check).
4. Improve examples honesty and archetype-accurate stubs (real backend shape for `backend-api`).
5. Align CLI namespaces (`eos intel context` alias); warn on `--force`.
6. Make decision-log required when `architectural_impact` is true.
7. Deduplicate intelligence vs phase-2 closeout doc roles.

### Low Priority

Nice-to-have refinements:

1. `eos doctor` health check.
2. Richer completeness validators (matrix rows, reuse recommendation present).
3. Converge `report` / `audit-report` naming.
4. Visual rendering of Mermaid graphs in docs site (if a site is added later).
5. Parallel/queued runs (multi-run state) — only if single-active-run becomes a real blocker.
6. Remove framework-root `.engineering-os/` residue from the repo or gitignore it.

---

## Appendix A — Simulated Workflows (dry-run)

### A.1 Feature Development

**Entry:** `eos init` → `eos detect` → (`eos intel scan` / bootstrap recommended) → `eos start feature-development`

| Phase | Inputs | CLI / actions | Artifacts | Decisions |
|-------|--------|---------------|-----------|-----------|
| bootstrap | Repo | `eos next`, `complete-phase` | repository-profile | — |
| discover | Request | fill discovery-notes; prefer DNA | discovery-notes | Ask human if blocked |
| contract | Discovery | mark ready; `gate contract-approval` | feature-contract | Scope approval |
| plan | Contract+DNA | `intel impact`, `intel reuse`, fill plans | impact, reuse, impl, verify, backend | `set-flag` if arch impact |
| approve | Gates | human approvals | — | Proceed / reject |
| implement | Approved plan | code changes | decision-log updates | Stop if new arch need |
| verify | Verify plan | run checks; evidence | verification-evidence | Fail/fix loop |
| review | Diff | review-notes | review-notes | Verdict |
| deliver | Evidence | delivery-prep; `delivery-signoff` | delivery-preparation | Ship/sign-off |

**DX:** Best documented (`docs/workflows/feature-development-walkthrough.md`). **Gap:** matrix auto-fill missing.

### A.2 Bug Fix

**Entry:** `eos start bug-fix`

Phases: bootstrap → discover → contract → plan → implement → verify → deliver (no approve/review phases).

Plan still requires the full intel artifact set including `backend-dependency` and `reuse-analysis` (**Verified:** `workflows/bug-fix.yaml`).

**DX gap:** No walkthrough; same planning weight as features may feel heavy for tiny defects (**Assumption** about user perception).

### A.3 Refactoring

**Entry:** `eos start refactoring`

- No feature-contract phase.
- `architectural_impact` defaults **true** at start (`workflow.js`).
- Plan requires impact + reuse + impl + verification; **not** backend-dependency.
- `architecture-approval` required before implement.

**DX gap:** Thin docs; characterization-test guidance is prose-only in `docs/workflows/refactoring.md`.

### A.4 Repository Audit

**Entry:** `eos start repository-audit` (`read_only: true`)

Phases: bootstrap → discover → audit (`required_artifacts: []`) → report (`audit-report`) → deliver (`delivery-preparation` + sign-off).

**Gaps:** Audit phase does not require a draft artifact; DNA/graphs not required; delivery-prep framing unclear for read-only work. Docs are purpose-only (`docs/workflows/repository-audit.md`).

---

## Appendix B — Evidence index (key paths)

- CLI: `engine/src/cli.js`
- Workflows: `workflows/*.yaml`
- Phases: `phases/*.md`, `phases/_index.yaml`
- Artifacts: `engine/src/artifacts.js`, `templates/*`
- Intelligence: `engine/src/intelligence/*`
- Docs: `docs/*`, `README.md`
- Adapters: `adapters/*`
- Examples: `examples/*`
- Tests: `engine/src/detect.test.js`, `engine/src/intelligence/reuse.test.js`

---

*End of Framework Readiness Report — Phase 3 assessment (documentation deliverable; framework code unchanged).*
