# Extending Workflows

## Add a workflow

1. Create `workflows/<id>.yaml` conforming to `engine/schemas/workflow.schema.json`.
2. Reference existing phase IDs from `phases/_index.yaml` when possible.
3. Document the workflow in `docs/workflows/<id>.md`.
4. Run `eos validate --framework`.

Example skeleton:

```yaml
id: my-workflow
name: My Workflow
description: Short description
phases:
  - id: bootstrap
    required_artifacts: [repository-profile]
  - id: discover
    required_artifacts: [discovery-notes]
  - id: deliver
    required_artifacts: [delivery-preparation]
    gates: [delivery-signoff]
```

## Add a phase

1. Add `phases/<id>.md` with goals, inputs, steps, exit criteria, and stop conditions.
2. Register it in `phases/_index.yaml`.
3. Reference it from one or more workflows.
4. If it introduces artifacts, add templates under `templates/` and schema enums if needed.

## Custom gates

Gate IDs are strings. Standard gates:

- `contract-approval`
- `architecture-approval`
- `delivery-signoff`

Custom gates work if the CLI records them via `eos gate <id> --approve`. Document them in the workflow guide.

## Local overlays

Consumers may add:

- `.engineering-os/knowledge-base/**` for org-specific patterns
- Extra checklists copied into artifacts

Do not fork phase markdown inside the consumer unless necessary; prefer upstream contributions.

## Validation

```bash
eos validate --framework   # from engineering-os repo
eos validate               # from consumer repo (state + active run)
```
