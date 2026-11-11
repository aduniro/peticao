#!/usr/bin/env python3
"""Read-only SP probe, streamed through the already trusted administrative SSH."""
import json
from pathlib import Path
import subprocess
import urllib.request

mem = {}
for line in Path('/proc/meminfo').read_text().splitlines():
    key, value = line.split(':', 1)
    if key in ('MemTotal', 'MemAvailable'):
        mem[key] = int(value.split()[0]) * 1024
cpu = [int(x) for x in Path('/proc/stat').read_text().splitlines()[0].split()[1:9]]
service = subprocess.check_output(['systemctl', 'show', 'peticao.service', '-p', 'MainPID', '-p', 'ActiveState'], text=True, timeout=5)
service = dict(line.split('=', 1) for line in service.splitlines() if '=' in line)
build = Path('/opt/peticao/app/.next/BUILD_ID')
result = {'boot_id': Path('/proc/sys/kernel/random/boot_id').read_text().strip(),
          'build_id': build.read_text().strip() if build.is_file() else None,
          'main_pid': int(service.get('MainPID', 0)), 'active_state': service.get('ActiveState'),
          'mem_available': mem['MemAvailable'], 'cpu_total': sum(cpu), 'cpu_idle': cpu[3] + cpu[4]}
try:
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:3000/', headers={'Host': 'sancionaintegral.org', 'User-Agent': 'PeticaoReadiness/1'}), timeout=5) as response:
        result['origin_http'] = response.status
except Exception as error:
    result['origin_error'] = type(error).__name__
print(json.dumps(result))
