"""Run gate and Next together; terminate both when either fails."""
import signal, subprocess, sys, time

children=[]
stopping=False
def stop(*args):
    global stopping
    stopping=True
    for child in children:
        if child.poll() is None:child.terminate()

for sig in (signal.SIGTERM,signal.SIGINT):signal.signal(sig,stop)
try:
    children.append(subprocess.Popen(['node','node_modules/next/dist/bin/next','start','--hostname','127.0.0.1','--port','3032']))
    children.append(subprocess.Popen(['python3','/opt/admin-mirror/gateway.py']))
    while not stopping and all(c.poll() is None for c in children):time.sleep(.25)
    result=next((c.returncode for c in children if c.poll() is not None),0)
finally:
    stop()
    for child in children:
        try:child.wait(timeout=10)
        except subprocess.TimeoutExpired:child.kill();child.wait()
sys.exit(result or 0)
