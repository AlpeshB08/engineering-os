# Knowledge Base

Searchable engineering memory for Engineering OS.

## Layout

| Path | Purpose |
|------|---------|
| `patterns/` | Preferred approaches |
| `anti-patterns/` | Discouraged or forbidden moves |
| `adr/` | Architecture Decision Records |
| `repo-archetypes/` | Discovery guidance per archetype |
| `playbooks/` | Operational guides |
| `lessons-learned/` | Delivery lessons |
| `common-bugs/` | Recurring defect patterns |
| `implementation-patterns/` | Reusable how-tos |
| `index.json` | Generated search index (`eos knowledge index`) |

## Entry format

```md
# Title

- **ID:** my-entry-id
- **Type:** lessons-learned
- **Tags:** tag1, tag2
- **Summary:** One-line summary
```

## Commands

```bash
eos knowledge index
eos knowledge search "backend contract"
eos knowledge add lessons-learned "Title here"
```

## Consumer overlays

Target repositories may add `.engineering-os/knowledge-base/` entries. Search merges framework + consumer sources.
