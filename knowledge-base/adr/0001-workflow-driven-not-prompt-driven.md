# ADR-0001: Workflow-driven, not prompt-driven

- Status: accepted
- Date: 2026-08-07

## Context

AI coding setups often rely on disconnected prompts that skip discovery, reuse, and verification.

## Decision

Engineering OS orchestrates work through declarative workflows and phases, with required artifacts and human gates.

## Consequences

Adapters stay thin; process changes happen in YAML/markdown, not per-tool prompt sprawl.
