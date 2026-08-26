# Phase: Discover

## Goal

Understand the request and repository reality before planning or coding.

## Inputs

- Human request
- Repository Profile
- Project DNA (`.engineering-os/intelligence/project-dna.md`) when present
- Knowledge base archetypes/playbooks

## Steps

1. Restate the request without expanding scope.
2. If started via `eos feature`, intake and Jira blocks are pre-seeded — enrich with evidence.
3. Run `eos intel jira` when Jira reference present (REST if configured; otherwise MCP/agent with normalized schema).
4. If Project DNA is missing, run `eos intel scan` (or rely on `eos feature` preflight).
5. Run `eos intel graphs` when graphs missing.
6. Explore relevant directories using DNA inventory; cite paths.
7. Identify reusable components (`eos intel reuse "<need>"` as helper).
8. Determine backend involvement — never invent APIs.
9. Fill `discovery-notes.md` with evidence citations.
10. Run `eos context` / rely on `eos next` context pack.

## Exit criteria

- [ ] `discovery-notes` completed with evidence citations
- [ ] Project DNA present or explicitly blocked with human question
- [ ] Open questions listed for the human when blockers exist
- [ ] No product code written in this phase

## Stop conditions

- Critical unknowns that prevent planning — ask the human

## Artifact status

When the artifact is ready, run `eos mark-artifact <id> <status>` (e.g. `ready`, `ready-for-approval`, `executed`, `complete`) or edit `EOS_ARTIFACT_STATUS` in the file.
