#!/usr/bin/env bash
# Runs the pinned DeepSeek Harness CLI with this distribution's isolated home.
# The caller's working directory stays the agent workspace.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BASE="${DSH_BASE:-$ROOT/../deepseekHarness/deepseek-harness}"
BIN="$BASE/apps/cli/lib/bin.js"

if [[ ! -f "$BIN" ]]; then
  echo "dsh.sh: built CLI not found at $BIN (run 'corepack pnpm run build' in the base checkout)" >&2
  exit 1
fi

# Provider keys: launch environment first, then this repo's .env, then the workspace-root .env.
for env_file in "$ROOT/.env" "$ROOT/../.env"; do
  if [[ -f "$env_file" ]]; then
    while IFS='=' read -r key value; do
      [[ "$key" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
      # Drop one pair of surrounding quotes, as dotenv files commonly carry them.
      if [[ "$value" =~ ^\'(.*)\'$ || "$value" =~ ^\"(.*)\"$ ]]; then value="${BASH_REMATCH[1]}"; fi
      # A variable the caller set, even to an empty value, is never replaced.
      [[ -n "${!key+set}" ]] || export "$key=$value"
    done < "$env_file"
  fi
done

export DSH_HOME="${DSH_HOME:-$ROOT/.dsh-home}"
export DSH_TELEMETRY_MODE="${DSH_TELEMETRY_MODE:-DISABLED}"

# `dsh plugin` needs pnpm; fall back to the corepack shim when none is installed.
command -v pnpm >/dev/null 2>&1 || export PATH="$ROOT/scripts/shims:$PATH"

exec node "$BIN" "$@"
