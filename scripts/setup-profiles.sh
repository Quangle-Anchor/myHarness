#!/usr/bin/env bash
# Creates this distribution's profiles in the isolated home. Each run rebuilds them
# from the shipped upstream templates, so the result does not depend on earlier state.
#   map-core-headless: headless template + core            (no RAG)
#   map-rag-headless:  headless template + core + rag      (optional RAG)
#   map-core:          web template + core + web           (no RAG)
#   map-rag:           web template + core + rag + web     (optional RAG)
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DSH="$ROOT/scripts/dsh.sh"

create() {
  local profile="$1" template="$2"
  shift 2
  "$DSH" --profile "$profile" --from-default-profile "$template" --dump-config > /dev/null
  for bundle in "$@"; do
    "$DSH" plugin --profile "$profile" add "$ROOT/bundles/$bundle" > /dev/null
  done
  echo "profile $profile: $template + $*"
}

create map-core-headless headless core
create map-rag-headless headless core rag
create map-core web core web
create map-rag web core rag web
