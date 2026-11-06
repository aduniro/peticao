#!/usr/bin/env bash
# Fixed root-owned executor; the unprivileged signal carries identity, never a command.
set -euo pipefail
HELPER=/usr/local/lib/peticao/publication.py
if [ "${PUBLICAR_TESTING:-}" = 1 ]; then HELPER="$(dirname "${BASH_SOURCE[0]}")/publication.py"; fi
exec /usr/bin/python3 "$HELPER" --run
