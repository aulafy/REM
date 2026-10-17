#!/bin/bash
# Alternativa sin Swift: cierre por señales; no ofrece el menú nativo de AppKit.
set -euo pipefail
cd "$(dirname "$0")/../Resources"
NODE="$(/bin/zsh -lc 'command -v node' 2>/dev/null || true)"
for candidate in /opt/homebrew/bin/node /usr/local/bin/node /opt/homebrew/opt/node@24/bin/node; do
  if [[ -z "$NODE" && -x "$candidate" ]]; then NODE="$candidate"; fi
done
if [[ -z "$NODE" ]]; then echo 'Instala Node.js 22.13 o superior desde https://nodejs.org' >&2; exit 1; fi
export PATH="$(dirname "$NODE"):/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"
"$NODE" --disable-warning=ExperimentalWarning src/server.js --open &
CHILD=$!
trap 'kill -TERM "$CHILD" 2>/dev/null || true; wait "$CHILD" 2>/dev/null || true' EXIT INT TERM HUP
wait "$CHILD"
