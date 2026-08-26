# Jira integration (hybrid)

Engineering OS supports **hybrid** Jira discovery:

1. **Engine REST** — when `.engineering-os/integrations/jira.json` is configured
2. **Agent/MCP fallback** — write the same normalized schema and ingest with `--from-json`

## Configuration

Create `.engineering-os/integrations/jira.json`:

```json
{
  "site": "https://your-org.atlassian.net",
  "email": "you@company.com",
  "apiToken": "your-api-token"
}
```

Alternatively use a personal access token:

```json
{
  "site": "https://your-org.atlassian.net",
  "pat": "your-pat"
}
```

## CLI

```bash
eos feature --jira PROJ-123
eos intel jira PROJ-123
eos intel jira https://your-org.atlassian.net/browse/PROJ-123
eos intel jira --from-json ./jira-PROJ-123.json
```

## Normalized schema

Single source of truth for REST and agent paths:

```json
{
  "key": "PROJ-123",
  "summary": "Feature title",
  "description": "Details",
  "acceptance_criteria": ["AC one", "AC two"],
  "business_rules": [],
  "metadata": { "type": "Story", "status": "Open", "labels": [] },
  "discovery": { "source": "agent", "complete": true, "completed_at": "..." },
  "assumptions": [],
  "open_questions": []
}
```

Discovery is **complete** when `discovery.complete === true`, summary or description is present, and either acceptance criteria or open questions exist.

## Outputs

Requirements are written to:

- `discovery-notes.md` → `## Jira requirements`
- `feature-contract.md` → Problem and Acceptance Criteria (when present)
- `.engineering-os/integrations/jira-PROJ-123.json` → machine-readable normalized issue

## BLOCKED behavior

When Jira is supplied in intake but discovery remains incomplete after REST failure and no valid agent JSON:

- Run is marked **BLOCKED** (`run.blocked`, orchestration blockers)
- Pre-approval pipeline stops before plan approval
- Implement phase is blocked (even with `--force`)

Resolve by configuring REST or running:

```bash
eos intel jira --from-json <normalized.json>
```

The orchestrator resumes the pre-approval pipeline after successful agent ingest.

## MCP / agent fallback

When REST is not configured, `eos feature` records a pending stub and exits with BLOCKED status. Use Atlassian MCP or manual fetch, write normalized JSON, then ingest with `--from-json`.

See `engine/src/integrations/jira.js` for schema validation (`JIRA_SCHEMA_FIELDS`).
