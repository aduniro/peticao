#!/usr/bin/env bash
# Executor do botão "Publicar" do painel (roda como ROOT, disparado pela unidade peticao-publicar.path quando o site grava o arquivo-sinal).
# O sinal NÃO carrega comando nenhum: só um id aleatório. Este script sempre roda o MESMO programa (peticao-deploy), sobre o que já está no peticao-stage.
# Defesas: o sinal precisa ser arquivo comum (não link), pequeno, recente e com id válido; é apagado ANTES de rodar (nunca repete); uma execução por vez (flock);
# estado e log ficam numa pasta de dono root (o site só lê), para o site não induzir o root a escrever em outro lugar.
# Variáveis (só para teste): PUBLICAR_PEDIDO, PUBLICAR_ESTADO_DIR, PUBLICAR_DEPLOY, PUBLICAR_LOCK, PUBLICAR_MAX_IDADE, PUBLICAR_TIMEOUT.
set -uo pipefail
PEDIDO="${PUBLICAR_PEDIDO:-/var/lib/peticao/publicar.pedido}"
DIR="${PUBLICAR_ESTADO_DIR:-/var/lib/peticao-publicar}"
DEPLOY="${PUBLICAR_DEPLOY:-/usr/local/sbin/peticao-deploy}"
LOCK="${PUBLICAR_LOCK:-/run/peticao-publicar.lock}"
MAX_IDADE="${PUBLICAR_MAX_IDADE:-900}"; LIMITE="${PUBLICAR_TIMEOUT:-1200}"
mkdir -p "$DIR"; chmod 755 "$DIR"
exec 9>"$LOCK"; flock -n 9 || exit 0
agora() { date -u +%Y-%m-%dT%H:%M:%SZ; }
estado() { # estado id inicio fim codigo  (todos os valores vêm de listas fixas ou de regex estrito: nada do sinal entra cru)
  local tmp; tmp="$(mktemp "$DIR/.estado.XXXXXX")"
  printf '{"estado":"%s","id":"%s","inicio":"%s","fim":"%s","codigo":%s}\n' "$1" "$2" "$3" "$4" "${5:-null}" > "$tmp"; chmod 644 "$tmp"; mv -f "$tmp" "$DIR/publicar.estado"; }
[ -e "$PEDIDO" ] || [ -L "$PEDIDO" ] || exit 0
if [ -L "$PEDIDO" ] || [ ! -f "$PEDIDO" ]; then rm -f -- "$PEDIDO"; estado recusado "-" "$(agora)" "$(agora)"; exit 0; fi
TAM="$(stat -c %s -- "$PEDIDO" 2>/dev/null || echo 99999)"; IDADE=$(( $(date +%s) - $(stat -c %Y -- "$PEDIDO" 2>/dev/null || echo 0) ))
ID="$(head -c 2048 -- "$PEDIDO" 2>/dev/null | grep -o '"id":"[a-f0-9]\{16\}"' | head -1 | cut -d'"' -f4)"
rm -f -- "$PEDIDO"   # apagado antes de rodar: um sinal vale uma vez
if [ "$TAM" -gt 2048 ] || [ -z "$ID" ]; then estado recusado "-" "$(agora)" "$(agora)"; exit 0; fi
if [ "$IDADE" -gt "$MAX_IDADE" ]; then estado expirado "$ID" "$(agora)" "$(agora)"; exit 0; fi
INI="$(agora)"; estado executando "$ID" "$INI" ""
timeout "$LIMITE" "$DEPLOY" > "$DIR/publicar.log.novo" 2>&1; COD=$?
tail -c 6000 "$DIR/publicar.log.novo" > "$DIR/publicar.log"; rm -f "$DIR/publicar.log.novo"; chmod 644 "$DIR/publicar.log"
if [ "$COD" -eq 0 ]; then estado ok "$ID" "$INI" "$(agora)" "$COD"; else estado falhou "$ID" "$INI" "$(agora)" "$COD"; fi
exit 0
