"""Civo-only persistent TCP22 guard. Outbound/forwarding rules remain untouched."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys

from network_rules import guard_commands


def guard(policy,persist=True):
    if os.geteuid()!=0:raise ValueError('Root required')
    status=json.loads(subprocess.run(['tailscale','status','--json'],capture_output=True,text=True,check=True).stdout)
    civo=next(x for x in policy['nodes'] if x['name']=='civo')
    if status.get('BackendState')!='Running' or civo['ipv4'] not in status['Self']['TailscaleIPs']:
        raise ValueError('Civo Tailnet identity not verified')
    root=Path('/var/lib/peticao-mesh-v3');root.mkdir(mode=0o700,exist_ok=True)
    signature=hashlib.sha256(json.dumps(policy['owner_public_addresses'],sort_keys=True).encode()).hexdigest()
    stamp=root/'guard-policy.json'
    if stamp.exists() and json.loads(stamp.read_text())['signature']!=signature:
        raise ValueError('Different SSH policy already installed')
    for v6 in [False,True]:
        binary='ip6tables' if v6 else 'iptables'
        exists=subprocess.run([binary,'-w','-S','PETICAO_CIVO_SSH'],capture_output=True).returncode==0
        if exists:
            if not stamp.exists():raise ValueError('Unowned SSH chain exists')
            for original in guard_commands(v6,policy['owner_public_addresses'])[1:]:
                check=list(original)
                if '-A' in check:check[check.index('-A')]='-C'
                else:
                    check[check.index('-I')]='-C';check.remove('1')
                if subprocess.run(check,capture_output=True).returncode:
                    raise ValueError('Owned chain incomplete; reconcile before retry')
            continue
        old=subprocess.run([binary+'-save'],capture_output=True,check=True).stdout
        backup=root/('before-guard-v6.rules' if v6 else 'before-guard-v4.rules')
        if not backup.exists():backup.write_bytes(old);backup.chmod(0o600)
        try:
            for command in guard_commands(v6,policy['owner_public_addresses']):
                subprocess.run(command,capture_output=True,check=True)
        except Exception:
            # Only our new chain/hook may be removed; no shared ruleset restore.
            subprocess.run([binary,'-w','-D','INPUT','-p','tcp','--dport','22','-j','PETICAO_CIVO_SSH'],capture_output=True)
            subprocess.run([binary,'-w','-F','PETICAO_CIVO_SSH'],capture_output=True)
            subprocess.run([binary,'-w','-X','PETICAO_CIVO_SSH'],capture_output=True)
            raise
    stamp.write_text(json.dumps(dict(signature=signature,owner_public_addresses=policy['owner_public_addresses']))+'\n');stamp.chmod(0o600)
    if persist:
        script=Path('/usr/local/sbin/peticao-civo-ssh-guard')
        lines=['#!/bin/sh','set -eu']
        for v6 in [False,True]:
            commands=guard_commands(v6,policy['owner_public_addresses']);binary='ip6tables' if v6 else 'iptables'
            lines.append('if ! '+binary+' -w -S PETICAO_CIVO_SSH >/dev/null 2>&1; then')
            for command in commands:lines.append('  '+' '.join(command))
            lines.append('fi')
        script.write_text('\n'.join(lines)+'\n');script.chmod(0o700)
        unit=Path('/etc/systemd/system/peticao-civo-ssh-guard.service')
        unit.write_text('[Unit]\nDescription=Owner-approved Civo SSH ingress policy\nDefaultDependencies=no\nAfter=local-fs.target\nBefore=network-pre.target\nWants=network-pre.target\n[Service]\nType=oneshot\nExecStart=/usr/local/sbin/peticao-civo-ssh-guard\nRemainAfterExit=yes\n[Install]\nWantedBy=multi-user.target\n')
        unit.chmod(0o644)
        subprocess.run(['systemctl','daemon-reload'],check=True,capture_output=True)
        subprocess.run(['systemctl','enable','peticao-civo-ssh-guard.service'],check=True,capture_output=True)
    receipt=dict(ssh_guard_applied=True,ipv4=True,ipv6=True,persistent=persist,
                 allowed_interfaces=['lo','tailscale0'],public_sources=policy['owner_public_addresses'],
                 outbound_changed=False,forwarding_changed=False,production_database_changed=False)
    (root/'GUARD-RESULT.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))


if __name__=='__main__':
    os.umask(0o077)
    try:guard(json.load(sys.stdin))
    except Exception as error:
        print('Civo guard failed: '+type(error).__name__)
        raise SystemExit(1)
