#!/usr/bin/env bash
# Engineering OS mutation guard hook for Cursor.
#
# Cursor runs hooks in a non-interactive shell that does not source ~/.zshrc or
# ~/.bashrc, so a version manager (nvm, fnm, asdf, volta) leaves `eos` off PATH even
# though it works in your terminal. These hooks are fail-closed, so an unresolvable
# command would block every file edit and shell command in the editor. Resolve the CLI
# from several places before giving up, and if we do give up, say exactly how to fix it.
set -uo pipefail

find_node() {
  if command -v node >/dev/null 2>&1; then command -v node; return 0; fi
  for candidate in \
    "$HOME/.nvm/versions/node"/*/bin/node \
    "$HOME/.fnm/node-versions"/*/installation/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.asdf/shims/node" \
    /opt/homebrew/bin/node \
    /usr/local/bin/node \
    /usr/bin/node
  do
    [ -x "$candidate" ] && { echo "$candidate"; return 0; }
  done
  return 1
}

# The framework location recorded by `eos init` in the consumer repo.
framework_home_from_state() {
  local state="${CURSOR_PROJECT_ROOT:-$PWD}/.engineering-os/state.json"
  [ -f "$state" ] || return 1
  sed -n 's/.*"framework_home"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$state" | head -1
}

# 1. eos already on PATH.
if command -v eos >/dev/null 2>&1; then
  exec eos guard hook "$@"
fi

# 2. eos installed by a version manager whose shims are not on this PATH.
for candidate in \
  "$HOME/.nvm/versions/node"/*/bin/eos \
  "$HOME/.fnm/node-versions"/*/installation/bin/eos \
  "$HOME/.volta/bin/eos" \
  "$HOME/.asdf/shims/eos" \
  /opt/homebrew/bin/eos \
  /usr/local/bin/eos
do
  [ -x "$candidate" ] && exec "$candidate" guard hook "$@"
done

# 3. Run the CLI directly out of the framework checkout.
NODE_BIN="$(find_node || true)"
if [ -n "$NODE_BIN" ]; then
  for home in "${ENGINEERING_OS_HOME:-}" "$(framework_home_from_state || true)"; do
    [ -n "$home" ] && [ -f "$home/engine/src/cli.js" ] && \
      exec "$NODE_BIN" "$home/engine/src/cli.js" guard hook "$@"
  done
fi

# Fail closed — but tell the user what to do instead of blocking silently.
cat >&2 <<'EOM'
Engineering OS guard hook could not find the `eos` CLI.

The hook is fail-closed, so edits stay blocked until this is fixed. Do NOT disable the
hook to get moving — that is what lets an agent rewrite recorded decisions and skip
workflow gates.

Fix it with ONE of:

  1. Make eos resolvable from a non-interactive shell:
       sudo ln -s "$(which eos)" /usr/local/bin/eos

  2. Point the hook at your framework checkout, in ~/.cursor/mcp env or your shell profile
     that Cursor inherits:
       export ENGINEERING_OS_HOME=/absolute/path/to/engineering-os

  3. Re-link the CLI:
       cd /path/to/engineering-os && npm link

Verify with:  eos guard implementation --json
EOM
exit 1
