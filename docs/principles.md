# Core Principles

Engineering OS encodes these principles as non-negotiable operating rules for humans and AI agents.

## 1. Discover before implementing

Do not write product code until the repository has been inspected and a discovery artifact exists for the active workflow.

**Evidence required:** Repository Profile (or refreshed detection) and discovery notes that cite real files, modules, and patterns.

## 2. Reuse before creating

Prefer existing components, utilities, stores, APIs, design tokens, and conventions over new abstractions.

**Evidence required:** A reuse map in the Implementation Plan listing candidates found in the repo and why each was accepted or rejected.

## 3. Repository-first, AI-second

The repository’s architecture, tooling, and conventions override generic AI defaults. Framework and adapter instructions never invent stack choices that contradict detected evidence.

## 4. Never assume missing systems

If a capability is not detected (backend access, tests, CI, design system, auth, etc.), treat it as unavailable. Document gaps; do not fabricate integrations.

**Especially:** Never assume backend APIs, schemas, or ownership. Use the Backend Dependency template when server contracts are unclear or inaccessible.

## 5. Never modify architecture without approval

Changes that alter module boundaries, data models, auth models, public APIs, or cross-cutting infrastructure require the `architecture-approval` gate before implementation.

## 6. Generate evidence, not assumptions

Claims about stack, behavior, or “how things work” must cite files, commands, or artifacts. Mark unknowns explicitly as `unknown`.

## 7. Verification is mandatory before delivery

A Verification Plan must exist and be executed (or deliberately skipped with evidence of missing capability) before Delivery Preparation is valid. Delivery sign-off is a human gate.

## How agents apply principles

When uncertain, agents must:

1. Re-read the Repository Profile
2. Run or re-run discovery against the codebase
3. Stop and ask the human rather than inventing systems
4. Record decisions in the Decision Log when a trade-off is approved
