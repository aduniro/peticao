#!/usr/bin/python3
import pathlib, subprocess
path = pathlib.Path('/etc/rancher/peticao-k3s/guard.nft')
prior = subprocess.run(['/usr/sbin/nft', 'list', 'table', 'inet', 'peticao_k3s_guard'], capture_output=True, timeout=15)
transaction = ('delete table inet peticao_k3s_guard\n' if prior.returncode == 0 else '') + path.read_text()
subprocess.run(['/usr/sbin/nft', '--check', '-f', '-'], input=transaction, text=True, check=True, timeout=15)
subprocess.run(['/usr/sbin/nft', '-f', '-'], input=transaction, text=True, check=True, timeout=15)
