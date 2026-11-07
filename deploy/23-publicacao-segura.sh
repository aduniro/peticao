#!/usr/bin/env bash
# Installs the fixed publisher and identity helper only; never deploys the application.
set -euo pipefail
[ "$(id -u)" = 0 ] || { echo "Rode como root."; exit 1; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
for file in publication.py 03-instalar-app.sh peticao-atualizar-stage.sh peticao-mail-rollback-guard.sh mail-rollback.sql; do [ -f "$HERE/$file" ] || { echo "Falta $file."; exit 1; }; done
/usr/bin/python3 - <<'PYLOCK'
import os,stat,grp
fd=os.open('/run/lock/peticao-deploy.lock',os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o644)
s=os.fstat(fd)
if not stat.S_ISREG(s.st_mode) or s.st_nlink!=1 or s.st_uid!=0 or s.st_mode & 0o022: raise SystemExit('Unsafe deployment lock')
os.fchmod(fd,0o640);os.fchown(fd,0,grp.getgrnam('adunir').gr_gid)
os.close(fd)
PYLOCK
exec 9</run/lock/peticao-deploy.lock; flock -x 9
BACKUP="/var/backups/peticao-publisher-$(date -u +%Y%m%dT%H%M%SZ)-$$"
install -d -m700 -o root -g root "$BACKUP"
[ ! -f /usr/local/sbin/peticao-deploy ] || cp -a /usr/local/sbin/peticao-deploy "$BACKUP/"
[ ! -f /usr/local/lib/peticao/publication.py ] || cp -a /usr/local/lib/peticao/publication.py "$BACKUP/"
install -d -m755 -o root -g root /usr/local/lib/peticao
install -m644 -o root -g root "$HERE/publication.py" /usr/local/lib/peticao/publication.py
/usr/bin/python3 /usr/local/lib/peticao/publication.py --ensure-lock
for original in /usr/local/sbin/peticao-mail-rollback-guard /usr/local/lib/peticao/mail-rollback.sql; do [ ! -f "$original" ] || cp -a "$original" "$BACKUP/"; done
install -m755 -o root -g root "$HERE/peticao-mail-rollback-guard.sh" /usr/local/sbin/peticao-mail-rollback-guard
install -m644 -o root -g root "$HERE/mail-rollback.sql" /usr/local/lib/peticao/mail-rollback.sql
install -m755 -o root -g root "$HERE/03-instalar-app.sh" /usr/local/sbin/peticao-deploy
if [ -f /usr/local/sbin/peticao-atualizar-stage ]; then cp -a /usr/local/sbin/peticao-atualizar-stage "$BACKUP/"; install -m755 -o root -g root "$HERE/peticao-atualizar-stage.sh" /usr/local/sbin/peticao-atualizar-stage; fi
cat > /usr/local/sbin/peticao-publicar-preparar <<'WRAPPER'
#!/bin/sh
set -eu
[ "$#" -eq 0 ] || exit 2
exec /usr/bin/python3 /usr/local/lib/peticao/publication.py --prepare
WRAPPER
chmod 755 /usr/local/sbin/peticao-publicar-preparar
printf 'Publicador instalado; aplicação não publicada. Backup: %s\n' "$BACKUP"
