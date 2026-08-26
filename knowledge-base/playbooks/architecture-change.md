# Playbook: Architecture change

1. Mark Implementation Plan `architectural impact: yes`.
2. Run `eos set-flag architectural_impact true`.
3. Stop at `architecture-approval` gate.
4. Only implement after `eos gate architecture-approval --approve`.
5. Capture the decision in Decision Log and consider promoting an ADR.
