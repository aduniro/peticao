#!/usr/bin/env bash
# (No ZORIN) Envia o código do app para a VPS, instala as dependências, compila e reinicia o serviço. Pede a senha do sudo da VPS.
# Uso:  /mnt/dev/peticao/deploy/publicar.sh        Use sempre que mudar o app (rotina de manutenção: testar -> publicar -> conferir).
set -euo pipefail
HOST="${PETICAO_SSH:-peticao}"; ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true || { echo "Não consegui entrar em '$HOST' por chave. Teste: ssh $HOST"; exit 1; }
echo "== enviando código (sem node_modules, .next, segredos nem dados locais)"
rsync -az --delete --info=stats1 \
  --exclude node_modules --exclude /.next --exclude /.next-dev --exclude /.pgdata --exclude /data \
  --exclude '.env*' --exclude /secrets --exclude /.npmrc --exclude /tsconfig.tsbuildinfo \
  "$ROOT/site/" "$HOST:peticao-stage/site/"
rsync -az --delete "$ROOT/deploy/" "$HOST:peticao-stage/deploy/"
# Com a permissão restrita instalada (05-configurar-v2.sh), o deploy roda sem senha; senão, cai no modo antigo (pede a senha do sudo).
if ssh -o BatchMode=yes "$HOST" 'test -x /usr/local/sbin/peticao-deploy'; then
  # O script do root é uma CÓPIA: se o 03 mudou, ele precisa ser reinstalado com a senha (05-configurar-v2.sh).
  A="$(sha256sum "$ROOT/deploy/03-instalar-app.sh" | cut -d' ' -f1)"; B="$(ssh -o BatchMode=yes "$HOST" 'sha256sum /usr/local/sbin/peticao-deploy' | cut -d' ' -f1)"
  [ "$A" = "$B" ] || { echo "ATENÇÃO: o script de deploy instalado na VPS está desatualizado. Rode UMA vez: ssh -t $HOST 'sudo bash ~/peticao-stage/deploy/05-configurar-v2.sh'"; }
  ssh -o BatchMode=yes "$HOST" 'sudo -n /usr/local/sbin/peticao-deploy'
else
  ssh -t "$HOST" 'sudo bash peticao-stage/deploy/03-instalar-app.sh'
fi
