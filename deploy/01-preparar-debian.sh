#!/usr/bin/env bash
# Prepara o Debian 13 para hospedar a petição: pacotes, usuário, PostgreSQL, serviço, proxy, firewall interno, backups.
# Idempotente (pode rodar de novo). Rode na VPS:  sudo bash 01-preparar-debian.sh
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
APP_USER=peticao; APP_HOME=/opt/peticao; APP_DIR=$APP_HOME/app; ENV_FILE=/etc/peticao/app.env
step() { printf '\n== %s\n' "$*"; }

step "1/9 Fontes do apt (tira o CD-ROM) e atualização"
sed -i 's/^deb cdrom:/# deb cdrom:/' /etc/apt/sources.list 2>/dev/null || true
apt-get update
apt-get -y upgrade

step "2/9 Pacotes (só do repositório oficial do Debian; sem snap)"
apt-get install -y --no-install-recommends ca-certificates curl git rsync tmux openssl ufw fail2ban python3-systemd \
  unattended-upgrades apt-listchanges nodejs npm postgresql postgresql-client
apt-cache show caddy >/dev/null 2>&1 || { echo "O pacote 'caddy' não está no repositório. Avise para escolhermos o nginx."; exit 1; }
apt-get install -y --no-install-recommends caddy
NODE_V="$(node -v)"; echo "Node: $NODE_V"
case "$NODE_V" in v2[0-9].*|v[3-9][0-9].*) ;; *) echo "AVISO: Node abaixo de 20 ($NODE_V). O Next 14 pede >= 18.17."; ;; esac

step "3/9 Usuário do app e pastas"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home-dir "$APP_HOME" --create-home --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" /etc/peticao /var/lib/peticao/outbox /var/backups/peticao
chown -R "$APP_USER:$APP_USER" "$APP_HOME" /var/lib/peticao
chown root:"$APP_USER" /etc/peticao; chmod 750 /etc/peticao
chmod 700 /var/backups/peticao

step "4/9 PostgreSQL (só em localhost) e variáveis do app"
systemctl enable --now postgresql
if [ ! -f "$ENV_FILE" ]; then
  PGPASS="$(openssl rand -hex 24)"
  runuser -u postgres -- psql -v ON_ERROR_STOP=1 -tAc "SELECT 1 FROM pg_roles WHERE rolname='peticao'" | grep -q 1 \
    && runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "ALTER ROLE peticao WITH LOGIN PASSWORD '$PGPASS'" \
    || runuser -u postgres -- psql -v ON_ERROR_STOP=1 -c "CREATE ROLE peticao WITH LOGIN PASSWORD '$PGPASS'"
  runuser -u postgres -- psql -tAc "SELECT 1 FROM pg_database WHERE datname='peticao'" | grep -q 1 \
    || runuser -u postgres -- createdb -O peticao -E UTF8 peticao
  IP4="$(hostname -I | awk '{print $1}')"
  umask 027
  cat > "$ENV_FILE" <<CFG
# Variáveis do app. Gerado por 01-preparar-debian.sh em $(date +%F).
# ATENÇÃO: HASH_PEPPER nunca pode mudar depois do lançamento (os CPFs são guardados como hash com ele).
NODE_ENV='production'
APP_URL='http://$IP4'
DATABASE_URL='postgres://peticao:$PGPASS@127.0.0.1:5432/peticao'
HASH_PEPPER='$(openssl rand -hex 32)'
ADMIN_PASSWORD='$(openssl rand -hex 12)'
CRON_SECRET='$(openssl rand -hex 16)'
MAIL_PROVIDER='dev'
MAIL_OUTBOX_DIR='/var/lib/peticao/outbox'
MAIL_FROM='Petição PLV 12/2026 <peticao@localhost>'
TRUSTED_PROXY_HOPS='1'
BATCH_SIZE='500'
PETITION_GOAL='20000'
FINAL_AT='2026-11-12T18:00:00-04:00'
APPROVER_EMAIL='peticaoifes.speed773@passmail.com'
SIGNER='none'
ICP_EXPECTED_CNPJ='15883671000115'
EVENT_RETENTION_DAYS='90'
CFG
  chown root:"$APP_USER" "$ENV_FILE"; chmod 640 "$ENV_FILE"
  echo "Variáveis criadas em $ENV_FILE (segredos aleatórios gerados; não aparecem aqui)."
else
  echo "$ENV_FILE já existe: mantido."
fi

step "5/9 Serviço systemd do app"
cat > /etc/systemd/system/peticao.service <<'CFG'
[Unit]
Description=Petição PLV 12/2026 (Next.js)
After=network-online.target postgresql.service
Wants=network-online.target
Requires=postgresql.service

[Service]
Type=simple
User=peticao
Group=peticao
WorkingDirectory=/opt/peticao/app
EnvironmentFile=/etc/peticao/app.env
ExecStart=/usr/bin/node node_modules/next/dist/bin/next start -p 3000 -H 127.0.0.1
Restart=always
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectControlGroups=true
ReadWritePaths=/opt/peticao/app/.next /var/lib/peticao
MemoryMax=2500M

[Install]
WantedBy=multi-user.target
CFG
systemctl daemon-reload
systemctl enable peticao >/dev/null 2>&1 || true   # sobe depois do 03-instalar-app.sh

step "6/9 Proxy Caddy (por enquanto só local; o domínio entra com ativar-dominio.sh)"
cat > /etc/caddy/Caddyfile <<'CFG'
# Provisório: só escuta em 127.0.0.1:8080 (teste por túnel SSH). O domínio e o HTTPS entram com ativar-dominio.sh.
http://127.0.0.1:8080 {
    encode zstd gzip
    reverse_proxy 127.0.0.1:3000
}
CFG
systemctl enable caddy >/dev/null 2>&1; systemctl restart caddy

step "7/9 Firewall interno (ufw; o do Vultr já restringe 443 à Cloudflare e o SSH ao seu IP)"
ufw default deny incoming; ufw default allow outgoing
ufw limit 22/tcp; ufw allow 443/tcp
ufw --force enable
ufw status verbose | head -12

step "8/9 Proteções automáticas: fail2ban e atualizações de segurança"
mkdir -p /etc/fail2ban/jail.d
cat > /etc/fail2ban/jail.d/10-sshd.local <<'CFG'
[sshd]
enabled = true
backend = systemd
maxretry = 5
findtime = 10m
bantime = 1h
CFG
systemctl enable --now fail2ban >/dev/null 2>&1; systemctl restart fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades

step "9/9 Backup diário do banco (14 dias; cópia para FORA do servidor fica por sua conta)"
cat > /usr/local/bin/peticao-backup <<'CFG'
#!/bin/sh
set -eu
d=/var/backups/peticao; mkdir -p "$d"; chmod 700 "$d"
f="$d/peticao-$(date +%Y%m%d-%H%M%S).sql.gz"
runuser -u postgres -- pg_dump peticao | gzip > "$f"; chmod 600 "$f"
find "$d" -name 'peticao-*.sql.gz' -mtime +14 -delete
CFG
chmod 755 /usr/local/bin/peticao-backup
cat > /etc/systemd/system/peticao-backup.service <<'CFG'
[Unit]
Description=Backup do banco da petição
[Service]
Type=oneshot
ExecStart=/usr/local/bin/peticao-backup
CFG
cat > /etc/systemd/system/peticao-backup.timer <<'CFG'
[Unit]
Description=Backup diário do banco da petição
[Timer]
OnCalendar=*-*-* 03:30:00
Persistent=true
[Install]
WantedBy=timers.target
CFG
systemctl daemon-reload; systemctl enable --now peticao-backup.timer >/dev/null 2>&1

echo; echo "PRONTO. Versões: node $(node -v) | postgres $(psql --version | awk '{print $3}') | caddy $(caddy version | awk '{print $1}')"
echo "Próximo (no Zorin): /mnt/dev/peticao/deploy/publicar.sh"
