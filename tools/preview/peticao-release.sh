#!/usr/bin/env bash
# Rotina de manutenção: testes -> typecheck -> build -> para o servidor -> sobe de novo com o Funnel ligado -> confere a URL pública.
# Uso: peticao-release.sh   (NO_OPEN=1 para não abrir o navegador)
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; SITE="$(cd "$DIR/../../site" && pwd)"
export TMPDIR="${TMPDIR:-/mnt/dev/peticao/.cache/tmp}"
cd "$SITE"
echo "== 1/4 testes e typecheck"; npm test 2>&1 | grep -E "^# (tests|pass|fail)"; npm run typecheck >/dev/null
echo "== 2/4 parando o servidor"; bash "$DIR/peticao-down.sh" >/dev/null 2>&1 || true
echo "== 3/4 build"; npm run build >/tmp/peticao-build.log 2>&1 || { tail -20 /tmp/peticao-build.log; exit 1; }
echo "== 4/4 subindo com o Funnel"; NO_OPEN="${NO_OPEN:-0}" bash "$DIR/peticao-up.sh"
URL="${PREVIEW_URL:-https://dell3576-zorin.tail1a6d71.ts.net}"
echo; for p in / /api/ultimas /capa/og.jpg /api/cartao-governo; do echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$URL$p")"; done
echo "/dev/outbox (deve ser 404 de fora) -> $(curl -s -o /dev/null -w '%{http_code}' --max-time 25 "$URL/dev/outbox")"
