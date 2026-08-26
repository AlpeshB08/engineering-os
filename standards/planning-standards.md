# Planning Standards

## Rules

1. Produce an Implementation Plan before writing product code (except pure discovery/audit/review workflows).
2. Plans must list sequenced steps and likely files.
3. Mark `architectural impact: yes` when changing boundaries, public APIs, data models, auth, or cross-cutting infra.
4. Include Backend Dependency whenever server contracts are involved or unclear.
5. Include a Verification Plan in the same planning window as implementation planning.
6. Do not start the implement phase while required gates are pending.
