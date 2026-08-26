# Figma design discovery (agent/MCP)

Engineering OS does **not** call the Figma REST API from core. When a feature intake includes a Figma URL, design discovery is **mandatory** and must be supplied by an agent or MCP process using a normalized JSON schema.

## When discovery is required

- `eos feature --figma <url>` → Figma discovery is **required**
- No Figma URL in intake → Figma step is skipped

If a URL is provided but discovery is incomplete, the run is marked **BLOCKED** until normalized JSON is ingested.

## Normalized schema

Write JSON matching:

```json
{
  "url": "https://www.figma.com/design/...",
  "screens": ["Screen name"],
  "interactions": ["User taps export"],
  "states": {
    "loading": ["Spinner while fetching"],
    "empty": ["No items message"],
    "error": ["Export failed toast"]
  },
  "components": ["ExportButton"],
  "responsive_notes": "Optional notes",
  "ui_requirements": ["Primary CTA in header"],
  "discovery": {
    "source": "agent",
    "complete": true,
    "completed_at": "2026-08-12T00:00:00.000Z"
  }
}
```

Discovery is **complete** when `discovery.complete === true` and at least one of `screens`, `ui_requirements`, or `components` is non-empty.

## CLI ingest

```bash
eos intel figma --from-json .engineering-os/integrations/figma-discovery.json
```

This writes:

- `.engineering-os/integrations/figma-discovery.json`
- `discovery-notes.md` → `## Design requirements (Figma)`

After ingest on an active blocked run, the orchestrator resumes the pre-approval pipeline automatically.

## Agent workflow

1. Run `eos feature --jira KEY --figma URL`
2. If BLOCKED on Figma, use Figma MCP/tools to inspect the file
3. Write normalized JSON to a file
4. Run `eos intel figma --from-json <path>`
5. Continue with `eos feature plan-bundle` and `eos gate plan-approval --approve`

See `engine/src/integrations/figma.js` for validation helpers.
