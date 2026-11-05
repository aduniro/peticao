#!/usr/bin/env bash
# Sobe o servidor da petição (sandbox), liga o Funnel do Tailscale, mostra o status e abre o navegador.
set -uo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
STATE="$(cd "$DIR/../.." && pwd)/preview-state"
URL="${PREVIEW_URL:-https://dell3576-zorin.tail1a6d71.ts.net}"
export PREVIEW_URL="$URL"
bash "$DIR/preview.sh" start || exit 1
tailscale funnel --bg "unix:$STATE/run/app.sock" || echo "Aviso: não consegui ligar o Funnel (veja LEIAME.md: operador/Funnel no painel do Tailscale)."
echo; tailscale funnel status
echo; bash "$DIR/preview.sh" status
echo; echo "Endereço público: $URL"
[ "${NO_OPEN:-0}" = 1 ] || (xdg-open "$URL" >/dev/null 2>&1 &) || true
