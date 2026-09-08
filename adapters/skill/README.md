# Agent Skill adapter

Packages `/feature` as a portable **Agent Skill** (`SKILL.md` with YAML frontmatter), so the
workflow loads only when it is relevant instead of sitting in always-on rules.

## Install

Copy the skill folder into your host's skills directory:

| Host | Destination |
|------|-------------|
| Cursor | `.cursor/skills/engineering-os-feature/SKILL.md` |
| Claude Code | `.claude/skills/engineering-os-feature/SKILL.md` |
| GitHub Copilot | `.github/skills/engineering-os-feature/SKILL.md` |

```bash
cp -r adapters/skill/engineering-os-feature /path/to/your-app/.cursor/skills/
```

The `description` in the frontmatter is what the host matches on, so the skill triggers when a
user pastes a ticket or Figma link or asks for a feature to be built end-to-end.
