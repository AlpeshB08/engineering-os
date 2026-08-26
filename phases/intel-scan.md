# Phase: Intel Scan

## Goal

Build or refresh repository intelligence: Project DNA, capability matrix, architecture summary, reuse inventory, known risks, standards summary, and dependency graphs.

## Inputs

- Repository Profile
- Discovery notes (when available)

## Steps

1. Run `eos intel scan`.
2. Run `eos intel graphs`.
3. Review `.engineering-os/intelligence/project-dna.md` and related summaries.
4. Note gaps/unknowns; do not invent inventory.
5. For bootstrap workflow, ensure report can summarize intelligence outputs.

## Exit criteria

- [ ] `project-dna` present under `.engineering-os/intelligence/`
- [ ] Capability matrix, architecture summary, reuse inventory, known risks, standards summary exist
- [ ] Graphs generated under `.engineering-os/intelligence/graphs/` (or explicitly documented as empty)

## Stop conditions

- Scanner cannot read the repository root
