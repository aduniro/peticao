#!/usr/bin/env bash
# Fixed root command; refuses to fence queues while a managed consumer may be running.
set -euo pipefail
[ "$(id -u)" = 0 ] && [ "$#" -eq 0 ] || exit 2
HELPER=/usr/local/lib/peticao/publication.py
SQL=/usr/local/lib/peticao/mail-rollback.sql
/usr/bin/python3 "$HELPER" --ensure-lock
if [[ "${PETICAO_DEPLOY_LOCK_FD:-}" =~ ^[0-9]+$ ]]; then
  /usr/bin/python3 "$HELPER" --validate-lock-fd "$PETICAO_DEPLOY_LOCK_FD"
  exec 9<&"$PETICAO_DEPLOY_LOCK_FD"
else
  exec 9</run/lock/peticao-deploy.lock
  flock -x 9
fi
[ "$(systemctl show peticao -p KillMode --value)" = control-group ] || { echo 'Rollback guard: unsupported app process isolation.' >&2; exit 1; }
for unit in peticao peticao-agendador.service peticao-a1-dispatch.service peticao-a1-worker.service; do
  load="$(systemctl show "$unit" -p LoadState --value)"
  if [ "$unit" != peticao ] && [ "$load" = not-found ]; then continue; fi
  [ "$load" = loaded ] || exit 1
  state="$(systemctl show "$unit" -p ActiveState --value)"
  case "$state" in inactive|failed) ;; *) echo 'Rollback guard: a managed consumer is still active.' >&2; exit 1;; esac
  [ "$(systemctl show "$unit" -p MainPID --value)" = 0 ] || exit 1
done
/usr/bin/python3 - "$SQL" <<'PYCHECK'
import os,stat,sys
p=sys.argv[1];s=os.lstat(p);parent=os.lstat(os.path.dirname(p))
if not stat.S_ISREG(s.st_mode) or not stat.S_ISDIR(parent.st_mode) or s.st_uid!=0 or parent.st_uid!=0 or (s.st_mode|parent.st_mode)&0o022: raise SystemExit('Unsafe rollback guard SQL')
PYCHECK
# Fixed local database/profile, no inherited libpq options, no password/psqlrc loading.
runuser -u postgres -- env -i PATH=/usr/bin:/bin psql -X -w -d peticao -v ON_ERROR_STOP=1 -f "$SQL"
echo 'Rollback mail fence committed; message payloads and signature data preserved.'
