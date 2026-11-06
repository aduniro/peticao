#!/usr/bin/env bash
# Instala/atualiza o app. Rode na VPS:  sudo bash 03-instalar-app.sh      (instalado como /usr/local/sbin/peticao-deploy, sem argumentos)
#
# SEGURANÇA: este script roda como root, mas o código vem de uma pasta que o usuário de deploy controla. Por isso:
#  - NENHUM argumento é aceito (a origem é fixa) e a pasta de origem não pode ser link simbólico;
#  - o root nunca LÊ a origem: quem lê é o usuário de deploy (tar) e quem grava é o usuário 'peticao' (tar), sem privilégio;
#  - links simbólicos que vierem na árvore são apagados; a troca é por diretório novo (sem rsync --delete como root);
#  - o app.env (segredos) só é carregado no build, não no npm ci (scripts de pacotes npm não o enxergam).
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode com sudo: sudo bash $0"; exit 1; }
[ "$#" -eq 0 ] || { echo "Este script não aceita argumentos."; exit 2; }
# Shared by manual publishing, the admin button, stage updates and candidate preparation.
HELPER=/usr/local/lib/peticao/publication.py
[ -f "$HELPER" ] || { echo "Instale antes deploy/23-publicacao-segura.sh."; exit 1; }
/usr/bin/python3 "$HELPER" --ensure-lock
if [[ "${PETICAO_DEPLOY_LOCK_FD:-}" =~ ^[0-9]+$ ]]; then
  /usr/bin/python3 "$HELPER" --validate-lock-fd "$PETICAO_DEPLOY_LOCK_FD"
  exec 9<&"$PETICAO_DEPLOY_LOCK_FD"
else
  exec 9</run/lock/peticao-deploy.lock
  flock -x 9
fi
DEPLOY_USER=adunir; APP_USER=peticao
APP_DIR=/opt/peticao/app; NEW_DIR=/opt/peticao/app.new; OLD_DIR=/opt/peticao/app.old; ENV_FILE=/etc/peticao/app.env
HOME_DIR="$(getent passwd "$DEPLOY_USER" | cut -d: -f6)"; SRC="$HOME_DIR/peticao-stage/site"
[ -d "$SRC" ] && [ ! -L "$SRC" ] && [ ! -L "$HOME_DIR/peticao-stage" ] || { echo "Origem inválida (ausente ou link simbólico): $SRC"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Falta $ENV_FILE: rode antes 01-preparar-debian.sh"; exit 1; }

# Bind even a manual deploy to its initial source, then verify the copied tree and the final source.
IDENTITY="$(runuser -u "$DEPLOY_USER" -- /usr/bin/python3 "$HELPER" --fingerprint "$SRC")"
SHA="$(/usr/bin/python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])' <<< "$IDENTITY")"
if [ -n "${PETICAO_CANDIDATO_SHA256:-}" ] && [ "$PETICAO_CANDIDATO_SHA256" != "$SHA" ]; then echo "Candidato alterado; publicação recusada."; exit 1; fi
verificar() { runuser -u "$1" -- /usr/bin/python3 "$HELPER" --fingerprint "$2" --expect "$SHA" >/dev/null; }

echo "== preparando $NEW_DIR (leitura como $DEPLOY_USER, escrita como $APP_USER)"
rm -rf "$NEW_DIR"; install -d -m 755 -o "$APP_USER" -g "$APP_USER" "$NEW_DIR"
runuser -u "$DEPLOY_USER" -- tar -C "$SRC" --exclude=node_modules --exclude=./.next --exclude=./.next-dev --exclude=./.pgdata --exclude=./data \
  --exclude='.env*' --exclude=secrets --exclude=.npmrc --exclude=tsconfig.tsbuildinfo --exclude=.git -cf - . \
  | runuser -u "$APP_USER" -- tar -C "$NEW_DIR" -xf - --no-same-owner --no-same-permissions
find "$NEW_DIR" -type l -delete                      # nada de links simbólicos vindos do staging
find "$NEW_DIR" -perm /6000 -exec chmod ug-s {} +    # sem setuid/setgid
[ -f "$NEW_DIR/package.json" ] || { echo "ERRO: a cópia não trouxe o package.json."; rm -rf "$NEW_DIR"; exit 1; }
verificar "$APP_USER" "$NEW_DIR"
# a pasta de dados locais (outbox do modo dev) fica fora da árvore do app; o app grava em /var/lib/peticao

run() { runuser -u "$APP_USER" -- env HOME=/opt/peticao PATH=/usr/bin:/bin bash -c "cd $NEW_DIR && $*"; }
# O build PRECISA do typescript (o Next lê os "paths" do tsconfig com ele): instala tudo (SEM os segredos), compila (COM as variáveis) e remove as dependências de desenvolvimento.
echo "== dependências (npm ci, incluindo as de desenvolvimento para compilar)"; run "npm ci --include=dev --no-audit --no-fund"
[ -d "$NEW_DIR/node_modules/typescript" ] || { echo "ERRO: typescript não foi instalado; o build falharia (alias @/)."; rm -rf "$NEW_DIR"; exit 1; }
echo "== compilando (next build)"; run "set -a && . $ENV_FILE && set +a && npm run build"
echo "== removendo dependências de desenvolvimento do servidor"; run "npm prune --omit=dev --no-audit --no-fund"

verificar "$DEPLOY_USER" "$SRC"
verificar "$APP_USER" "$NEW_DIR"
echo "== trocando a versão em uso (a anterior fica em $OLD_DIR até o novo responder)"
rm -rf "$OLD_DIR"; [ -d "$APP_DIR" ] && mv "$APP_DIR" "$OLD_DIR"; mv "$NEW_DIR" "$APP_DIR"
systemctl restart peticao
code=000
for i in $(seq 1 30); do code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 http://127.0.0.1:3000/ || true)"; [ "$code" = 200 ] && break; sleep 2; done
echo "página inicial: HTTP $code"
echo "contador:       $(curl -s --max-time 5 http://127.0.0.1:3000/api/contador || true)"
if [ "$code" != 200 ]; then
  echo "ERRO: o app novo não respondeu; voltando à versão anterior."
  if [ -d "$OLD_DIR" ]; then rm -rf "$APP_DIR"; mv "$OLD_DIR" "$APP_DIR"; systemctl restart peticao; fi
  echo "Veja: sudo journalctl -u peticao -n 50 --no-pager"; exit 1
fi
rm -rf "$OLD_DIR"
systemctl --no-pager --lines=3 status peticao | sed -n '1,6p'
