# Change Control Standards

## Rules

1. Human gates are hard stops. Agents must not bypass them.
2. `contract-approval` is required before feature implementation.
3. `architecture-approval` is required when architectural impact is yes (and for refactoring workflows when non-local).
4. `delivery-signoff` is required to complete delivery workflows.
5. Rejected gates block progress until the artifact is revised and re-approved.
6. High-impact changes include: auth, payments, migrations, public API breaks, monorepo boundary changes, new external vendors.
