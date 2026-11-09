"""Single persistent local receiver. Each cycle reads the VPS and writes only the mirror."""
import fcntl, json, os, signal, subprocess, time
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
STATE=Path(os.environ.get('ADMIN_MIRROR_STATE',str(Path.home()/'.local/share/peticao-admin-mirror')))
stopping=False
child=None
def stop(*args):
    global stopping
    stopping=True
    if child and child.poll() is None:child.terminate()
for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,stop)

def status(value):
    p=STATE/'sync-status.json.part';p.write_text(json.dumps(dict(value,at=time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()))));p.chmod(0o600);p.replace(STATE/'sync-status.json')

def run(script):
    global child
    child=subprocess.Popen(['/mnt/apps/peticao-final/_externos/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node','--max-old-space-size=512',str(ROOT/'tools/admin-mirror'/script)],cwd=ROOT)
    return child.wait()

if __name__=='__main__':
    os.umask(0o077);STATE.mkdir(parents=True,exist_ok=True,mode=0o700)
    with (STATE/'sync.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise SystemExit('MIRROR_SYNC_ALREADY_RUNNING')
        try:
            while not stopping:
                started=time.monotonic();status({'phase':'capturing'})
                capture=run('capture.mjs')
                if stopping:break
                if capture==0:
                    status({'phase':'importing'})
                    code=run('import-local.mjs')
                    status({'phase':'waiting' if code==0 else 'failed','elapsedSeconds':round(time.monotonic()-started,2)})
                    if code==0 and not stopping:run('cleanup.mjs')
                else:status({'phase':'failed','stage':'capture'})
                deadline=started+30
                if time.monotonic()>=deadline:
                    if not stopping:time.sleep(1)
                else:
                    while not stopping and time.monotonic()<deadline:time.sleep(min(1,max(.05,deadline-time.monotonic())))
        finally:status({'phase':'stopped'})
