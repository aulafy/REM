#!/bin/sh
# Perfil de desarrollo REM. No modifica HOME ni la configuración personal.
set -eu
REM_DEV_ROOT="${REM_DEV_ROOT:-$HOME/.local/share/rem-dev}"
if [ ! -x "$REM_DEV_ROOT/gentle-ai" ]; then
  echo 'Gentle AI is not installed in this profile; see docs/PARALLEL_DEVELOPMENT.md.' >&2
  exit 1
fi
export GENTLE_AI_HOME="$REM_DEV_ROOT/gentle-state"
export XDG_CONFIG_HOME="$REM_DEV_ROOT/config"
export OPENCODE_CONFIG_DIR="$REM_DEV_ROOT/config/opencode"
export GENTLE_AI_NO_SELF_UPDATE=1
export PATH="$REM_DEV_ROOT:$PATH"
exec "$REM_DEV_ROOT/gentle-ai" "$@"
