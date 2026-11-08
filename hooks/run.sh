#!/usr/bin/env bash
# Use the CLI shipped with this plugin, preserving hook stdin and arguments.
set -u

if ! command -v node >/dev/null 2>&1; then
  echo "agentic-retro: Node.js 20 or later is required for plugin hooks." >&2
  exit 0
fi

exec node "${BASH_SOURCE[0]%/*}/../cli/agentic-retro.js" "$@"
