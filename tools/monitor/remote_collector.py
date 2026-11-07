#!/usr/bin/env python3
"""Unprivileged remote health collector. Never reads app configuration or signer data."""
import datetime, json, os, pathlib, signal, sqlite3, subprocess, time
ROOT=pathlib.Path.home()/'.local/state/peticao-monitor';ROOT.mkdir(parents=True,exist_ok=True,mode=0o700)
DB=ROOT/'health.sqlite';STOP=False

def snapshot():
 units=['peticao.service','caddy.service','postgresql@17-main.service','reacher.service']
 r=subprocess.run(['systemctl','is-active',*units],capture_output=True,text=True,timeout=5)
 uptime=float(pathlib.Path('/proc/uptime').read_text().split()[0]);hz=os.sysconf('SC_CLK_TCK');page=os.sysconf('SC_PAGE_SIZE');processes=[]
 for p in pathlib.Path('/proc').iterdir():
  if not p.name.isdigit():continue
  try:
   name=(p/'comm').read_text().strip()
   if not name.startswith(('node','next','python','postgres','caddy','reacher','codex','npm')):continue
   fields=(p/'stat').read_text().rpartition(') ')[2].split();elapsed=int(max(0,uptime-int(fields[19])/hz));memory=round(int(fields[21])*page/1024**2,1)
   try:cwd=str((p/'cwd').resolve(strict=True))
   except OSError:cwd='(diretório protegido pelo serviço)'
   processes.append({'pid':int(p.name),'name':name,'elapsed':elapsed,'memory':memory,'status':fields[0],'cwd':cwd})
  except (OSError,ValueError,IndexError):continue
 return {'collector_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'services':dict(zip(units,r.stdout.splitlines())),'processes':processes,'load':os.getloadavg(),'diagnostics_source':pathlib.Path('/opt/peticao/app/src/lib/signup-diagnostics.ts').is_file(),'diagnostics_build':pathlib.Path('/opt/peticao/app/.next/server/app/api/sign-diagnostic/route.js').is_file()}

def main():
 global STOP
 os.umask(0o077)
 for s in (signal.SIGINT,signal.SIGTERM):signal.signal(s,lambda *_:globals().__setitem__('STOP',True))
 with sqlite3.connect(DB) as db:db.executescript('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS latest(id INTEGER PRIMARY KEY,payload TEXT); CREATE TABLE IF NOT EXISTS history(seq INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT,payload TEXT);')
 DB.chmod(0o600)
 while not STOP:
  try:
   data=snapshot();raw=json.dumps(data)
   with sqlite3.connect(DB) as db:
    db.execute('INSERT OR REPLACE INTO latest VALUES(1,?)',(raw,));db.execute('INSERT INTO history(at,payload) VALUES(?,?)',(data['collector_at'],raw));db.execute('DELETE FROM history WHERE seq<(SELECT max(seq)-4320 FROM history)')
  except (OSError,ValueError,sqlite3.Error,subprocess.TimeoutExpired):pass
  for _ in range(20):
   if STOP:break
   time.sleep(1)
if __name__=='__main__':main()
