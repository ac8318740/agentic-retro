#!/usr/bin/env bash
# Tiny wrapper so the plugin never fails a session when the CLI isn't installed.
#
# The plugin ships no copy of the agentic-retro CLI (no shim, no vendored
# binary). When the CLI is on PATH, this hands off to it unchanged, stdin and
# all. When it's missing, this prints one line and exits 0 so the harness
# keeps going either way.

set -u

if command -v agentic-retro >/dev/null 2>&1; then
  exec agentic-retro "$@"
fi

echo "agentic-retro: CLI not found on PATH. Run: npm install -g agentic-retro"
exit 0
