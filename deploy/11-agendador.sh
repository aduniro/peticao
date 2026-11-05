#!/usr/bin/env bash
# Instala o agendador do servidor (systemd timer, a cada 2 minutos): reenvia a fila de e-mails e avança os lotes.
# Chama os endereços /api/cron/fila e /api/cron/tick do app, em 127.0.0.1, com Authorization: Bearer $CRON_SECRET (gerado aqui, se faltar).
# Uso (root na VPS):  bash 11-agendador.sh        |   remover:  bash 11-agendador.sh --remover
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
ENVF=/etc/peticao/app.env
if [ "${1:-}" = "--remover" ]; then systemctl disable --now peticao-agendador.timer 2>/dev/null || true; rm -f /etc/systemd/system/peticao-agendador.{service,timer}; systemctl daemon-reload; echo "Agendador removido."; exit 0; fi
if ! grep -q '^CRON_SECRET=' "$ENVF"; then
  S="$(head -c 32 /dev/urandom | base64 | tr -d '/+=\n' | head -c 40)"
  tmp="$(mktemp)"; grep -v '^CRON_SECRET=' "$ENVF" > "$tmp" || true; printf "CRON_SECRET='%s'\n" "$S" >> "$tmp"
  install -m 640 -o root -g peticao "$tmp" "$ENVF"; rm -f "$tmp"; echo "CRON_SECRET gerado (não exibido)."; RESTART=1
fi
cat > /etc/systemd/system/peticao-agendador.service <<'CFG'
[Unit]
Description=Agendador da petição: reenvio da fila de e-mails e avanço dos lotes
After=peticao.service
[Service]
Type=oneshot
User=peticao
Group=peticao
ExecStart=/bin/bash -c 'S=$(grep "^CRON_SECRET=" /etc/peticao/app.env | cut -d= -f2- | sed "s/^.//;s/.$//"); for p in fila tick; do curl -fsS -m 170 -X POST -H "Authorization: Bearer $S" http://127.0.0.1:3000/api/cron/$p > /dev/null || echo "falhou: $p" >&2; done'
CFG
cat > /etc/systemd/system/peticao-agendador.timer <<'CFG'
[Unit]
Description=Agendador da petição (a cada 2 minutos)
[Timer]
OnBootSec=2min
OnUnitActiveSec=2min
AccuracySec=15s
[Install]
WantedBy=timers.target
CFG
systemctl daemon-reload; systemctl enable --now peticao-agendador.timer
[ "${RESTART:-0}" = 1 ] && systemctl restart peticao
echo "Agendador ativo:"; systemctl list-timers peticao-agendador.timer --no-pager | head -3
