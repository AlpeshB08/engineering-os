# Getting Started

## Prerequisites

- Node.js 18+
- A target git repository (application or monorepo)
- An AI coding assistant (optional but recommended)

## Install Engineering OS

```bash
git clone <this-repo-url> engineering-os
cd engineering-os
npm install
npm link
```

Alternatively, invoke without linking:

```bash
node /path/to/engineering-os/engine/src/cli.js <command>
```

## Initialize a target repository

```bash
cd /path/to/your-app
eos init
eos detect
```

This creates `.engineering-os/` with state and a Repository Profile filled from detection evidence.

## Start your first workflow

```bash
eos start feature-development
eos status
eos next
```

Copy the `eos next` output into your AI chat, or install an [adapter](adapters/) so the agent loads instructions automatically.

## Recommended first path

1. Install the [Generic adapter](../adapters/generic/) or your tool-specific adapter
2. Ask the agent: “Follow Engineering OS. Run `eos status` and complete the current phase.”
3. Review and approve the Feature Contract (`eos gate contract-approval --approve`)
4. Review the Implementation Plan; approve architecture if required
5. Allow implementation only after gates clear
6. Verify, then complete Delivery Preparation
7. Sign off: `eos gate delivery-signoff --approve`

## Next reading

- [Installing into a repo](installing-into-a-repo.md)
- [Architecture](architecture.md)
- [Feature Development workflow](workflows/feature-development.md)
- [Framework Readiness Report (Phase 3)](framework-readiness-report.md)

## Intelligence quick path

```bash
eos intel scan
eos intel graphs
eos start repository-bootstrap   # or feature-development
eos next                         # prints context pack path
eos knowledge search "reuse"
```

See [intelligence.md](intelligence.md).

## Production readiness

- [Framework Readiness Report (Phase 3)](framework-readiness-report.md) — end-to-end assessment of workflows, CLI, artifacts, docs, and DX gaps.
