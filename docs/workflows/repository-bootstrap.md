# Workflow: Repository Bootstrap

**ID:** `repository-bootstrap`

## Purpose

First-run (or refresh) intelligence pack for a repository.

## Phase sequence

bootstrap → discover → intel-scan → report → deliver

## Outputs

- Repository Profile
- Project DNA
- Capability Matrix
- Architecture Summary
- Reuse Inventory
- Known Risks
- Engineering Standards Summary
- Dependency graphs
- Report + delivery sign-off

## Commands

```bash
eos start repository-bootstrap
eos next
# during intel-scan:
eos intel scan
eos intel graphs
eos mark-artifact discovery-notes ready
# ...
eos gate delivery-signoff --approve
```
