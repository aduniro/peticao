#!/usr/bin/env bash
# Pré-visualização isolada da petição, para revisão pelo pessoal da ADUNIR.
#   preview.sh start | stop | status | check | bridge-test | admin-senha | logs
# O site e o Postgres rodam dentro de um sandbox (bubblewrap) SEM rede, sem acesso ao seu $HOME nem a outros discos.
# A única ligação com o mundo é um socket Unix; um repasse mínimo (forward.mjs) o expõe em 127.0.0.1:$PORT.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SITE="$ROOT/site"
STATE="${PREVIEW_STATE:-$ROOT/preview-state}"
PORT="${PREVIEW_PORT:-3100}"
URL="${PREVIEW_URL:-http://127.0.0.1:$PORT}"
APP_PID="$STATE/run/app.pid"; FWD_PID="$STATE/run/forward.pid"; BRG_PID="$STATE/run/bridge.pid"
has_key() { [ -s "$STATE/secrets/cpf-brasil-api-key" ] || [ -s "$ROOT/secrets/cpf-brasil-api-key" ]; }

alive() { [ -f "$1" ] && kill -0 "$(cat "$1")" 2>/dev/null; }
rand() { head -c 48 /dev/urandom | base64 | tr -d '/+=\n' | head -c "${1:-40}"; }

prepare_state() {
  mkdir -p "$STATE"/{gate,pgdata,outbox,run,logs,next-cache,secrets,etc}
  chmod 700 "$STATE" "$STATE/secrets" "$STATE/gate"
  for f in pg-password pepper admin-password; do
    [ -s "$STATE/secrets/$f" ] || { rand 40 > "$STATE/secrets/$f"; chmod 600 "$STATE/secrets/$f"; }
  done
  echo "sandbox:x:$(id -u):$(id -g):sandbox:/tmp:/bin/sh" > "$STATE/etc/passwd"
  echo "sandbox:x:$(id -g):" > "$STATE/etc/group"
  echo "127.0.0.1 localhost" > "$STATE/etc/hosts"
  # CPF fictício para testar a janela de identidade (mãe: Ana Maria da Conceição · nascimento: 15/08/1985). Só é criado se NÃO houver chave real na pré-visualização.
  has_key || [ -s "$STATE/cpf-mock.json" ] || echo '{"52998224725":{"nome":"MARIA DA SILVA SOUZA","mae":"ANA MARIA DA CONCEIÇÃO","nasc":"15/08/1985"}}' > "$STATE/cpf-mock.json"
  mkdir -p "$SITE/.next/cache"
}

# Monta o comando do sandbox em BW. Sem rede (só loopback interno), sem $HOME, sistema somente leitura.
build_bw() {
  # A chave da CPF Brasil NUNCA entra no sandbox: o arquivo aparece vazio lá dentro (quem a usa é a ponte, fora do sandbox).
  HIDE=(); [ -e "$STATE/secrets/cpf-brasil-api-key" ] && HIDE=(--ro-bind /dev/null /state/secrets/cpf-brasil-api-key)
  BW=(bwrap --unshare-user --unshare-ipc --unshare-pid --unshare-net --unshare-uts --unshare-cgroup --die-with-parent --new-session --disable-userns --clearenv
    --ro-bind /usr /usr --symlink usr/lib /lib --symlink usr/lib64 /lib64 --symlink usr/bin /bin --symlink usr/sbin /sbin
    --ro-bind /etc/ld.so.cache /etc/ld.so.cache --ro-bind /etc/nsswitch.conf /etc/nsswitch.conf
    --ro-bind "$STATE/etc/passwd" /etc/passwd --ro-bind "$STATE/etc/group" /etc/group --ro-bind "$STATE/etc/hosts" /etc/hosts
    --proc /proc --dev /dev --tmpfs /tmp
    --ro-bind "$SITE" /app --tmpfs /app/.pgdata --tmpfs /app/data --bind "$STATE/next-cache" /app/.next/cache
    --bind "$STATE" /state "${HIDE[@]}" --remount-ro / --chdir /app
    --setenv HOME /tmp --setenv PATH /usr/bin:/bin --setenv LANG C.UTF-8 --setenv NODE_ENV production
    --setenv PREVIEW_MODE 1 --setenv ADMIN_NO_PASSWORD "${ADMIN_NO_PASSWORD:-0}" --setenv PREVIEW_PUBLIC "${PREVIEW_PUBLIC:-1}" --setenv MAIL_PROVIDER dev --setenv MAIL_OUTBOX_DIR /state/outbox --setenv APP_URL "$URL"
    --setenv STATE_DIR /state --setenv GATE_DIR /state/gate --setenv APP_SOCKET /state/run/app.sock --setenv APP_DIR /app
    --setenv NEXT_TELEMETRY_DISABLED 1)
}

bridge_start() {
  rm -f "$STATE/run/egress.sock" "$STATE/run/cpf-via-bridge"
  setsid nohup node "$ROOT/tools/preview/egress-bridge.mjs" "$STATE/run/egress.sock" "$STATE" "$ROOT" > "$STATE/logs/bridge.log" 2>&1 < /dev/null &
  echo $! > "$BRG_PID"
  for _ in $(seq 1 20); do [ -S "$STATE/run/egress.sock" ] && break; sleep 0.5; done
  [ -S "$STATE/run/egress.sock" ] || { echo "A ponte de saída não subiu. Veja: $STATE/logs/bridge.log"; exit 1; }
  has_key && touch "$STATE/run/cpf-via-bridge"   # com chave real no computador, o CPF é consultado pela ponte
  true
}
bridge_query() { curl -s --max-time 15 --unix-socket "$STATE/run/egress.sock" -o /dev/null -w "%{http_code}" "http://ponte$1"; }

limits() { LIM=(); [ "${PREVIEW_NO_LIMITS:-0}" = 1 ] && return 0; systemd-run --user --scope --quiet -p MemoryMax=1500M -p TasksMax=400 -p CPUQuota=200% true 2>/dev/null && LIM=(systemd-run --user --scope --quiet -p MemoryMax=1500M -p TasksMax=400 -p CPUQuota=200% --) || echo "aviso: limites de memória/CPU indisponíveis (systemd --user)"; }

case "${1:-help}" in
  start)
    [ "${PREVIEW_PUBLIC:-1}" = 1 ] || [ -s "$STATE/gate/password.scrypt" ] || { echo "Senha de acesso ainda não registrada. Rode:  cd $SITE && npm run preview:senha"; exit 1; }
    alive "$APP_PID" && { echo "Já está rodando."; exit 0; }
    prepare_state
    if [ ! -f "$SITE/.next/BUILD_ID" ] || [ "${REBUILD:-0}" = 1 ]; then (cd "$SITE" && npm run build); fi
    rm -f "$STATE/run/stop" "$STATE/run/app.sock"
    bridge_start
    build_bw; limits
    # O supervisor (bash) fica vivo como "pai" do bwrap: --die-with-parent derruba o sandbox se ele morrer.
    setsid nohup bash -c '"$@"; echo "sandbox terminou (código $?)"' _ "${LIM[@]}" "${BW[@]}" node /app/scripts/preview-entry.mjs > "$STATE/logs/app.log" 2>&1 < /dev/null &
    echo $! > "$APP_PID"
    for _ in $(seq 1 90); do [ -S "$STATE/run/app.sock" ] && break; sleep 1; done
    [ -S "$STATE/run/app.sock" ] || { echo "Falhou ao iniciar. Veja: $STATE/logs/app.log"; tail -15 "$STATE/logs/app.log"; exit 1; }
    setsid nohup node "$ROOT/tools/preview/forward.mjs" "$STATE/run/app.sock" "$PORT" > "$STATE/logs/forward.log" 2>&1 < /dev/null &
    echo $! > "$FWD_PID"
    sleep 1
    if [ "${ADMIN_NO_PASSWORD:-0}" = 1 ]; then touch "$STATE/run/admin-sem-senha"; echo "ATENÇÃO: admin SEM SENHA (temporário). Para voltar: preview.sh stop e start sem ADMIN_NO_PASSWORD=1"; else rm -f "$STATE/run/admin-sem-senha"; fi
    echo "Pré-visualização no ar: http://127.0.0.1:$PORT $([ "${PREVIEW_PUBLIC:-1}" = 1 ] && echo "(acesso aberto, sem senha)" || echo "(protegida por senha)")"
    echo "Para abrir na internet: veja tools/preview/LEIAME.md"
    ;;
  stop)
    if alive "$FWD_PID"; then kill "$(cat "$FWD_PID")" 2>/dev/null || true; fi
    if alive "$APP_PID"; then
      touch "$STATE/run/stop"
      for _ in $(seq 1 20); do alive "$APP_PID" || break; sleep 1; done
      alive "$APP_PID" && kill "$(cat "$APP_PID")" 2>/dev/null || true
    fi
    if alive "$BRG_PID"; then kill "$(cat "$BRG_PID")" 2>/dev/null || true; fi
    rm -f "$APP_PID" "$FWD_PID" "$BRG_PID" "$STATE/run/stop" "$STATE/run/egress.sock" "$STATE/run/cpf-via-bridge"; echo "Parado."
    ;;
  status)
    alive "$APP_PID" && echo "sandbox: rodando (pid $(cat "$APP_PID"))" || echo "sandbox: parado"
    alive "$FWD_PID" && echo "repasse: 127.0.0.1:$PORT" || echo "repasse: parado"
    alive "$BRG_PID" && echo "ponte de saída (CPF e domínios): no ar · chave da CPF Brasil: $(has_key && echo encontrada || echo AUSENTE, usando dados de teste)" || echo "ponte de saída: parada"
    [ -f "$STATE/run/admin-sem-senha" ] && echo "admin: SEM SENHA (temporário! reverter: preview.sh stop; preview.sh start sem ADMIN_NO_PASSWORD=1)" || echo "admin: com senha"
    [ "${PREVIEW_PUBLIC:-1}" = 1 ] && echo "acesso: ABERTO (sem senha; /dev/* só local). Para voltar à senha: PREVIEW_PUBLIC=0 preview.sh start" || { [ -s "$STATE/gate/password.scrypt" ] && echo "senha de acesso: registrada" || echo "senha de acesso: NÃO registrada"; }
    ;;
  check)
    prepare_state; build_bw
    "${BW[@]}" node /app/scripts/preview-isolation-check.mjs
    ;;
  bridge-test)
    alive "$BRG_PID" || { echo "A ponte não está no ar (rode: preview.sh start)."; exit 1; }
    echo "Consulta ao CPF de teste público da documentação (00000000191) pela ponte: HTTP $(bridge_query /cpf/00000000191)"
    echo "  200 = chave válida · 401 = chave inválida/expirada/plano · 429 = limite · 502 = sem rede no computador · 503 = sem chave"
    echo "Checagem de domínio pela ponte (exemplo: mit.edu): HTTP $(bridge_query /domain/mit.edu)"
    ;;
  admin-senha)
    echo "Senha do painel /admin da pré-visualização (separada da senha de acesso):"; cat "$STATE/secrets/admin-password"
    ;;
  logs) tail -n "${2:-50}" "$STATE/logs/app.log" ;;
  *) sed -n '2,5p' "$0" ;;
esac
