# Phase: Bootstrap

## Goal

Ensure Engineering OS is initialized in the consumer repository and a Repository Profile is available.

## Inputs

- Target repository root
- Framework home (`ENGINEERING_OS_HOME` or derived)

## Steps

1. If `.engineering-os/` is missing, run `eos init`.
2. Run `eos detect` to refresh capabilities and Repository Profile.
3. Confirm `repository-profile.md` exists and archetype is set (may be `unknown`).
4. If Project DNA is missing, recommend `eos intel scan` (required later in discover/intel-scan).
5. Read principles and local profile constraints.
6. Prefer `eos next` context pack over full-repo loading.

## Exit criteria

- [ ] `.engineering-os/state.json` exists
- [ ] `repository-profile` artifact present
- [ ] Capabilities recorded in state

## Stop conditions

- Not inside a readable project directory
- Framework home unresolved
