"""Install the local bridge and encrypted SSH transport without printing credentials."""
import json
import os
import pathlib
import subprocess
import time

os.umask(0o077)
root = pathlib.Path('/mnt/dev/peticao/tools/whatsapp')
folder = pathlib.Path('/home/barre/.config/whatsapp-executor')
folder.mkdir(parents=True, exist_ok=True, mode=0o700)
script = '''import json,subprocess
c=json.loads(subprocess.check_output(['/usr/bin/docker','inspect','waha-waha-1']))[0]
env=dict(x.split('=',1) for x in c['Config'].get('Env',[]) if '=' in x)
print(json.dumps({'key':env.get('WAHA_API_KEY',env.get('WHATSAPP_API_KEY',''))}))'''
import shlex
auth = json.loads(subprocess.check_output(['/usr/bin/ssh', 'cluster-waha', '/usr/bin/python3 -c ' + shlex.quote(script)]))
path = folder / 'config.json'
if not path.exists():
    path.write_text(json.dumps({
        'api_url': 'http://127.0.0.1:13061', 'api_key': auth['key'],
        'executor': 'r93d07b', 'vigia': 'r688b96',
        'owner_chat': '5511900000001@c.us',
        'owner_aliases': ['5511900000001@c.us', '74599471521914@lid'],
        'enabled_at': time.time(), 'reports_enabled': True,
        'speech_python': '/home/barre/.local/share/whatsapp-executor/venv/bin/python',
    }, indent=2))
    path.chmod(0o600)
units = pathlib.Path('/home/barre/.config/systemd/user')
units.mkdir(parents=True, exist_ok=True)
(units / 'whatsapp-waha-tunnel.service').write_text('''[Unit]
Description=Private SSH transport to WAHA on sanciona-integral
After=network-online.target
Wants=network-online.target

[Service]
ExecStart=/usr/bin/ssh -N -o ExitOnForwardFailure=yes -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -L 127.0.0.1:13061:127.0.0.1:3000 cluster-waha
Restart=always
RestartSec=5
UMask=0077

[Install]
WantedBy=default.target
''')
(units / 'whatsapp-executor-vigia.service').write_text('''[Unit]
Description=Owner-only WhatsApp EXECUTOR and VIGIA bridge
After=network-online.target whatsapp-waha-tunnel.service
Wants=network-online.target whatsapp-waha-tunnel.service

[Service]
WorkingDirectory=/mnt/dev/peticao/tools/whatsapp
ExecStart=/usr/bin/python3 -u /mnt/dev/peticao/tools/whatsapp/bridge.py
Restart=always
RestartSec=5
TimeoutStopSec=30
KillMode=control-group
UMask=0077

[Install]
WantedBy=default.target
''')
subprocess.run(['/usr/bin/systemctl', '--user', 'daemon-reload'], check=True)
subprocess.run(['/usr/bin/systemctl', '--user', 'enable', '--now', 'whatsapp-waha-tunnel.service', 'whatsapp-executor-vigia.service'], check=True)
print('Installed bridge and private tunnel. No credentials printed.')
