#!/usr/bin/env bash
# (No ZORIN) Envia os scripts de servidor para a VPS e roda o IPv6 fixo + a preparação do Debian. Pede a senha do sudo da VPS.
# Uso:  /mnt/dev/peticao/deploy/preparar.sh        (PETICAO_SSH=outro-alias para trocar o destino; padrão: peticao)
set -euo pipefail
HOST="${PETICAO_SSH:-peticao}"; DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ssh -o BatchMode=yes -o ConnectTimeout=10 "$HOST" true || { echo "Não consegui entrar em '$HOST' por chave. Teste: ssh $HOST"; exit 1; }
ssh "$HOST" 'rm -rf peticao-stage/deploy && mkdir -p peticao-stage'
scp -rq "$DIR" "$HOST:peticao-stage/"
ssh -t "$HOST" 'sudo bash peticao-stage/deploy/00-ipv6.sh && sudo bash peticao-stage/deploy/01-preparar-debian.sh'
