#!/usr/bin/env bash
# Abre o site LOCAL de testes (nada vai para a internet nem para a VPS). Sobe o banco e o servidor se ainda não estiverem no ar.
# Uso: peticao-local.sh site      → página de assinaturas (http://localhost:3321/)
#      peticao-local.sh admin     → monitor de acessos do admin (senha local: admin-dev)
set -u
RAIZ="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"; SITE="$RAIZ/site"; LOG="$RAIZ/.cache/atalhos"; mkdir -p "$LOG" "$RAIZ/.cache/tmp"
PORTA=3321; DB=54329
alvo="${1:-site}"
case "$alvo" in site) URL="http://localhost:$PORTA/" ;; admin) URL="http://localhost:$PORTA/admin/monitor" ;; *) echo "uso: $0 site|admin"; exit 2 ;; esac
aviso() { command -v notify-send >/dev/null && notify-send "Petição (teste local)" "$1" 2>/dev/null; echo "$1"; }
ouvindo() { ss -ltn 2>/dev/null | grep -q ":$1 "; }
espera() { local n=0; until "$@"; do n=$((n+1)); [ $n -gt 90 ] && return 1; sleep 1; done; }

cd "$SITE" || exit 1
if ! ouvindo $DB; then
  aviso "Subindo o banco de testes…"
  nohup npm run db:dev >"$LOG/banco.log" 2>&1 &
  espera ouvindo $DB || { aviso "O banco não subiu. Veja $LOG/banco.log"; exit 1; }
fi
if ! ouvindo $PORTA; then
  aviso "Subindo o site de testes (a primeira abertura demora)…"
  DATABASE_URL="postgres://peticao:peticao@localhost:$DB/peticao" MAIL_PROVIDER=dev MAIL_REPLY_TO=adunir@sancionaintegral.org ADMIN_PASSWORD=admin-dev \
    APP_URL="http://localhost:$PORTA" IDENTITY_CHECK_MODE=off TMPDIR="$RAIZ/.cache/tmp" \
    nohup npx next dev -p $PORTA >"$LOG/site.log" 2>&1 &
  espera curl -s -o /dev/null "http://localhost:$PORTA/" || { aviso "O site não subiu. Veja $LOG/site.log"; exit 1; }
fi
# aquece a rota pedida (a primeira compilação do modo de desenvolvimento é lenta) e abre no navegador
curl -s -o /dev/null --max-time 120 "$URL"
xdg-open "$URL" >/dev/null 2>&1 &
aviso "Aberto: $URL"
