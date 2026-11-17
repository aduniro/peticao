#!/usr/bin/env bash
# Configuração ÚNICA da VPS (rode UMA vez, com a senha do sudo):
#   ssh -t peticao 'sudo bash ~/peticao-stage/deploy/05-configurar-v2.sh'
# 1) Docker (pacote do Debian, sem snap) e o Reacher (verificação de e-mail) preso à versão v0.11.10, só em 127.0.0.1:8081 (a 8080 é do teste local do Caddy);
# 2) liga o app ao Reacher (REACHER_URL / REACHER_SECRET em /etc/peticao/app.env);
# 3) instala o deploy sem senha, RESTRITO: um script do root em /usr/local/sbin e uma regra sudoers que deixa o usuário adunir rodar SÓ ele, sem argumentos.
#    O script nunca lê a pasta de origem como root (veja o cabeçalho de 03-instalar-app.sh). Se o 03 mudar, rode este script de novo.
# 4) roda o deploy (compila e reinicia) e testa.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
export DEBIAN_FRONTEND=noninteractive
DEPLOY_USER="${SUDO_USER:-adunir}"; HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE=/etc/peticao/app.env; REACHER_ENV=/etc/peticao/reacher.env; IMAGE="reacherhq/backend:v0.11.10"
step() { printf '\n== %s\n' "$*"; }
set_var() { local tmp; tmp="$(mktemp)"; grep -v "^$1=" "$ENV_FILE" > "$tmp" || true; printf "%s='%s'\n" "$1" "$2" >> "$tmp"; install -m 640 -o root -g peticao "$tmp" "$ENV_FILE"; rm -f "$tmp"; }

step "1/5 Docker (repositório oficial do Debian)"
apt-get update -qq
# No Debian 13 o 'docker.io' traz só o servidor; o comando 'docker' vem no pacote 'docker-cli' (sem ele o 'docker pull' falha).
apt-get install -y --no-install-recommends docker.io docker-cli
systemctl enable --now docker
DOCKER="$(command -v docker)" || { echo "ERRO: o comando 'docker' não existe depois da instalação (pacote docker-cli)."; exit 1; }
for i in $(seq 1 20); do "$DOCKER" info >/dev/null 2>&1 && break; sleep 1; done
"$DOCKER" info >/dev/null 2>&1 || { echo "ERRO: o servidor do Docker não respondeu."; systemctl --no-pager status docker | head -8; exit 1; }
echo "Docker: $("$DOCKER" --version) em $DOCKER"

step "2/5 Reacher $IMAGE (só em 127.0.0.1:8081)"
"$DOCKER" pull "$IMAGE"
if [ ! -f "$REACHER_ENV" ]; then
  SECRET="$(openssl rand -hex 24)"
  umask 077
  cat > "$REACHER_ENV" <<CFG
RCH__HEADER_SECRET=$SECRET
RCH__HTTP_HOST=0.0.0.0
RCH__BACKEND_NAME=peticao-sp
RCH__HELLO_NAME=verifica.sancionapresidente.org
RCH__FROM_EMAIL=sonda@verifica.sancionapresidente.org
RCH__SMTP_TIMEOUT=30
RCH__THROTTLE__MAX_REQUESTS_PER_MINUTE=30
RCH__THROTTLE__MAX_REQUESTS_PER_DAY=5000
CFG
  chmod 600 "$REACHER_ENV"
fi
# Identidade das sondagens SMTP: um subdomínio de sancionapresidente.org, separado do domínio que envia as confirmações (sancionaintegral.org)
# e sem caixa real. Reaplicada a cada execução (o arquivo pode ter sido criado por uma versão antiga deste script).
set_reacher() { local tmp; tmp="$(mktemp)"; grep -v "^$1=" "$REACHER_ENV" > "$tmp" || true; printf '%s=%s\n' "$1" "$2" >> "$tmp"; install -m 600 -o root -g root "$tmp" "$REACHER_ENV"; rm -f "$tmp"; }
set_reacher RCH__HELLO_NAME "${PROBE_HELLO:-verifica.sancionapresidente.org}"
set_reacher RCH__FROM_EMAIL "${PROBE_FROM:-sonda@verifica.sancionapresidente.org}"
cat > /etc/systemd/system/reacher.service <<CFG
[Unit]
Description=Reacher (verificação de e-mail)
After=docker.service
Requires=docker.service
[Service]
Restart=always
RestartSec=5
ExecStartPre=-$DOCKER rm -f reacher
ExecStart=$DOCKER run --rm --name reacher --env-file $REACHER_ENV -p 127.0.0.1:8081:8080 --memory 512m --cpus 1 --pids-limit 256 --cap-drop ALL --security-opt no-new-privileges $IMAGE
ExecStop=$DOCKER stop reacher
[Install]
WantedBy=multi-user.target
CFG
systemctl daemon-reload; systemctl enable reacher >/dev/null 2>&1; systemctl restart reacher
SECRET="$(grep '^RCH__HEADER_SECRET=' "$REACHER_ENV" | cut -d= -f2-)"
echo -n "aguardando o Reacher"; for i in $(seq 1 40); do code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 -X POST -H "x-reacher-secret: $SECRET" -H 'content-type: application/json' -d '{"to_email":"teste@example.com"}' http://127.0.0.1:8081/v0/check_email || true)"; [ "$code" = 200 ] && break; echo -n "."; sleep 3; done; echo
echo "Reacher respondeu HTTP $code (200 = ok)"; [ "$code" = 200 ] || { journalctl -u reacher -n 25 --no-pager; echo "AVISO: o Reacher não respondeu; o app seguirá sem ele (falha aberta)."; }

step "3/5 Ligando o app ao Reacher"
set_var REACHER_URL "http://127.0.0.1:8081"; set_var REACHER_SECRET "$SECRET"

step "4/5 Deploy sem senha, restrito (só este script, sem argumentos)"
install -d -m 755 -o root -g root /usr/local/lib/peticao
install -m 644 -o root -g root "$HERE/publication.py" /usr/local/lib/peticao/publication.py
/usr/bin/python3 /usr/local/lib/peticao/publication.py --ensure-lock
install -m 755 -o root -g root "$HERE/03-instalar-app.sh" /usr/local/sbin/peticao-deploy
cat > /etc/sudoers.d/peticao-deploy <<CFG
# Permite a $DEPLOY_USER rodar APENAS o deploy da petição como root, sem senha. O "" no fim PROÍBE qualquer argumento
# (sem ele, o sudoers aceitaria qualquer argumento).
$DEPLOY_USER ALL=(root) NOPASSWD: /usr/local/sbin/peticao-deploy ""
CFG
chmod 440 /etc/sudoers.d/peticao-deploy
visudo -cf /etc/sudoers.d/peticao-deploy || { rm -f /etc/sudoers.d/peticao-deploy; echo "ERRO no sudoers; regra removida."; exit 1; }

step "5/5 Deploy (compila e reinicia)"
/usr/local/sbin/peticao-deploy
echo; echo "PRONTO. A partir de agora, no Zorin, basta rodar /mnt/dev/peticao/deploy/publicar.sh (sem senha)."
echo "Reacher: status = $(systemctl is-active reacher) | porta 25 de saída: bloqueada pelo Vultr até o provedor liberar (abra um chamado)."
