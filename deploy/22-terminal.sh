#!/usr/bin/env bash
# Instala o serviço do Terminal do painel (rode como root na VPS). NÃO liga o Terminal: ele só aceita comandos depois que o dono o liga na Central de Ações (por tempo limitado).
#   scp /mnt/dev/peticao-parcial/deploy/22-terminal.sh /mnt/dev/peticao-parcial/site/scripts/terminal-servico.mjs peticao-root:/root/ && ssh peticao-root 'bash /root/22-terminal.sh'
# Serviço SEPARADO do site: usuário próprio sem privilégios (peticao-term), só 127.0.0.1, sem rede externa, sem acesso a /opt/peticao, /etc/peticao, /var/lib/peticao, /home e /root.
# O segredo do ticket é gerado aqui (nunca exibido): vai para /etc/peticao-terminal/segredo (só root; o serviço lê por LoadCredential) e para TERMINAL_SECRET em /etc/peticao/app.env (o site assina os tickets).
# Remover:  bash 22-terminal.sh --remover
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
ENVF=/etc/peticao/app.env; DIR_SEG=/etc/peticao-terminal; BIN=/usr/local/lib/peticao-terminal
if [ "${1:-}" = "--remover" ]; then
  systemctl disable --now peticao-terminal.service 2>/dev/null || true
  rm -f /etc/systemd/system/peticao-terminal.service; rm -rf "$BIN" "$DIR_SEG"
  if [ -f "$ENVF" ] && grep -q '^TERMINAL_SECRET=' "$ENVF"; then tmp="$(mktemp)"; grep -v '^TERMINAL_SECRET=' "$ENVF" > "$tmp" || true; install -m 640 -o root -g peticao "$tmp" "$ENVF"; rm -f "$tmp"; fi
  systemctl daemon-reload; echo "Terminal removido (reinicie o site para ele esquecer o segredo: systemctl restart peticao)."; exit 0
fi
AQUI="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="$AQUI/terminal-servico.mjs"; [ -f "$SRC" ] || SRC="$AQUI/../site/scripts/terminal-servico.mjs"
[ -f "$SRC" ] || { echo "Falta terminal-servico.mjs (copie junto com este script)."; exit 1; }
[ -f "$ENVF" ] || { echo "Não achei $ENVF: instale o app primeiro."; exit 1; }
NODE="$(command -v node)" || { echo "node não encontrado."; exit 1; }
id peticao-term >/dev/null 2>&1 || useradd --system --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin peticao-term
install -d -m 755 -o root -g root "$BIN"; install -m 644 -o root -g root "$SRC" "$BIN/servico.mjs"
install -d -m 700 -o root -g root "$DIR_SEG"
if [ ! -s "$DIR_SEG/segredo" ]; then ( umask 077; head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c 64 > "$DIR_SEG/segredo" ); chmod 600 "$DIR_SEG/segredo"; echo "segredo do ticket gerado (não exibido)."; fi
SEG="$(cat "$DIR_SEG/segredo")"
if ! grep -q '^TERMINAL_SECRET=' "$ENVF" || [ "$(grep '^TERMINAL_SECRET=' "$ENVF" | cut -d= -f2- | tr -d "'")" != "$SEG" ]; then
  tmp="$(mktemp)"; grep -v '^TERMINAL_SECRET=' "$ENVF" > "$tmp" || true; printf "TERMINAL_SECRET='%s'\n" "$SEG" >> "$tmp"
  install -m 640 -o root -g peticao "$tmp" "$ENVF"; rm -f "$tmp"; echo "TERMINAL_SECRET gravado em $ENVF (reinicie o site para valer: systemctl restart peticao)."
fi
cat > /etc/systemd/system/peticao-terminal.service <<CFG
[Unit]
Description=Terminal do painel da petição (sem privilégios; só aceita comando com ticket do site)
After=network.target
[Service]
User=peticao-term
Group=peticao-term
LoadCredential=segredo:$DIR_SEG/segredo
Environment=PORT=3911
ExecStart=$NODE $BIN/servico.mjs
Restart=on-failure
NoNewPrivileges=yes
CapabilityBoundingSet=
AmbientCapabilities=
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectKernelLogs=yes
ProtectControlGroups=yes
ProtectProc=invisible
ProcSubset=pid
RestrictNamespaces=yes
RestrictSUIDSGID=yes
LockPersonality=yes
MemoryDenyWriteExecute=no
RestrictAddressFamilies=AF_UNIX AF_INET
IPAddressDeny=any
IPAddressAllow=127.0.0.1
InaccessiblePaths=/opt/peticao /etc/peticao /etc/peticao-terminal /var/lib/peticao /var/lib/peticao-publicar /root /home /srv /var/backups /mnt
SystemCallFilter=@system-service
SystemCallErrorNumber=EPERM
MemoryMax=256M
TasksMax=64
CPUQuota=50%
[Install]
WantedBy=multi-user.target
CFG
systemctl daemon-reload; systemctl enable --now peticao-terminal.service
sleep 1; systemctl is-active peticao-terminal.service
echo "== serviço do Terminal instalado. O Terminal continua DESLIGADO: ligue na Central de Ações do painel."
