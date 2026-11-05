#!/usr/bin/env bash
# Liga/desliga o proxy SOCKS5 do Reacher (as verificações de SMTP saem pela sua CASA, via tailnet, onde a porta 25 funciona).
#   sudo bash 07-reacher-proxy.sh on      (usa 100.105.193.63:1080, o Zorin na tailnet; mude com PROXY_HOST/PROXY_PORT)
#   sudo bash 07-reacher-proxy.sh off     (volta a tentar direto, pela VPS; a porta 25 dela é bloqueada pelo Vultr)
#   sudo bash 07-reacher-proxy.sh status
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0 on|off|status"; exit 1; }
REACHER_ENV=/etc/peticao/reacher.env; HOST="${PROXY_HOST:-100.105.193.63}"; PORT="${PROXY_PORT:-1080}"
[ -f "$REACHER_ENV" ] || { echo "Falta $REACHER_ENV: rode antes 05-configurar-v2.sh"; exit 1; }
drop() { local tmp; tmp="$(mktemp)"; grep -v -E '^RCH__PROXY__' "$REACHER_ENV" > "$tmp" || true; install -m 600 -o root -g root "$tmp" "$REACHER_ENV"; rm -f "$tmp"; }
case "${1:-status}" in
  on)
    [[ "$HOST" =~ ^100\.(6[4-9]|[7-9][0-9]|1[01][0-9]|12[0-7])\.[0-9]+\.[0-9]+$ ]] || { echo "O proxy precisa estar na tailnet (100.64.0.0/10). Recusado: $HOST"; exit 1; }
    drop; printf 'RCH__PROXY__HOST=%s\nRCH__PROXY__PORT=%s\nRCH__PROXY__TIMEOUT_MS=10000\n' "$HOST" "$PORT" >> "$REACHER_ENV"
    systemctl restart reacher; echo "Proxy LIGADO: $HOST:$PORT (reiniciando o Reacher)";;
  off) drop; systemctl restart reacher; echo "Proxy DESLIGADO (reiniciando o Reacher)";;
  status) grep -E '^RCH__PROXY__(HOST|PORT)' "$REACHER_ENV" || echo "(sem proxy: o Reacher tenta direto)"; echo "reacher: $(systemctl is-active reacher)";;
  *) echo "uso: sudo bash $0 on|off|status"; exit 1;;
esac
sleep 3
if timeout 5 bash -c "exec 3<>/dev/tcp/$HOST/$PORT" 2>/dev/null; then echo "alcança o proxy? SIM"; else echo "alcança o proxy? NÃO - ligue-o no Zorin com: socks25 on"; fi
