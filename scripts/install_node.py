#!/usr/bin/env python3
"""Root-only installation of reviewed node files, preserving Docker and existing units.

Run only after external coordination gates. Refuses an existing installation;
it is intentionally not an upgrade, restore, uninstall or firewall reset tool.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess
import tempfile

EXPECTED_SHA = '265b3ee6a3198ef14033c63ef46cbb32370d83795199fb6d1b01f21575eddbda'
CONFIG_DIR = Path('/etc/rancher/peticao-k3s')
BINARY = Path('/usr/local/lib/peticao-k3s/k3s')
UNIT_DIR = Path('/etc/systemd/system')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--bundle', type=Path, required=True)
    parser.add_argument('--review-receipt', type=Path, required=True)
    parser.add_argument('--node', choices=['santiago', 'local', 'sp'], required=True)
    parser.add_argument('--agent-token', type=Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        raise PermissionError('root_required')
    # The receipt must come from the local ledger verifier, not from a job payload.
    receipt = json.loads(args.review_receipt.read_text())
    if not receipt.get('peer_ack_verified') or not receipt.get('lease_valid') or receipt.get('node') != args.node:
        raise PermissionError('reviewed_manifest_and_current_lease_required')
    if args.node == 'sp' and not receipt.get('post_deploy_stable_baseline_verified'):
        raise PermissionError('sp_post_deploy_stable_baseline_required')
    if CONFIG_DIR.exists() or BINARY.exists() or (UNIT_DIR / 'peticao-k3s.service').exists():
        raise FileExistsError('existing_installation_requires_separate_review')
    binary = args.bundle / 'k3s'
    if hashlib.sha256(binary.read_bytes()).hexdigest() != EXPECTED_SHA:
        raise ValueError('binary_checksum_mismatch')
    config = json.loads((args.bundle / 'config.yaml').read_text())
    if config.get('node-name') != 'peticao-' + args.node or config.get('data-dir') != '/var/lib/peticao-k3s':
        raise ValueError('unexpected_node_configuration')
    expected_files = ['config.yaml', 'guard.nft', 'peticao-k3s.service', 'peticao-k3s-guard.service']
    hashes = {name: hashlib.sha256((args.bundle / name).read_bytes()).hexdigest() for name in expected_files}
    if hashes != receipt.get('manifest_sha256'):
        raise ValueError('reviewed_files_changed')
    subprocess.run(['/usr/sbin/nft', '--check', '-f', str(args.bundle / 'guard.nft')], check=True, timeout=15)
    if subprocess.run(['/usr/sbin/nft', 'list', 'table', 'inet', 'peticao_k3s_guard'], capture_output=True, timeout=15).returncode == 0:
        raise FileExistsError('existing_guard_requires_separate_review')
    if shutil.disk_usage('/var/lib').free < 20 * 2**30:
        raise ValueError('runtime_disk_headroom_below_20GiB')
    if args.node != 'santiago':
        if not args.agent_token or args.agent_token.stat().st_mode & 0o077:
            raise PermissionError('private_agent_token_required')
        agent_token = args.agent_token.read_text().strip()
        if not agent_token.startswith('K10') or '::' not in agent_token:
            raise ValueError('secure_CA_pinned_agent_token_required')
    else:
        agent_token = secrets.token_hex(32)
    # Capture prior state before any service or network change. Never restore by
    # flushing nftables: that would destroy Docker/Tailnet rules.
    backup = Path(tempfile.mkdtemp(prefix='peticao-k3s-before-', dir='/var/backups'))
    backup.chmod(0o700)
    for filename, command in {
        'nft.txt': ['/usr/sbin/nft', 'list', 'ruleset'],
        'routes.json': ['/usr/sbin/ip', '-j', 'route', 'show', 'table', 'all'],
        'services.txt': ['/usr/bin/systemctl', 'list-units', '--type=service', '--state=running', '--no-pager'],
        'sockets.txt': ['/usr/bin/ss', '-H', '-lntup'],
    }.items():
        result = subprocess.run(command, capture_output=True, timeout=20, check=True)
        (backup / filename).write_bytes(result.stdout)
    (backup / 'review.json').write_text(json.dumps(receipt, indent=2) + '\n')
    CONFIG_DIR.mkdir(parents=True, mode=0o700)
    BINARY.parent.mkdir(parents=True, mode=0o755)
    shutil.copyfile(binary, BINARY)
    BINARY.chmod(0o755)
    for name in ('config.yaml', 'guard.nft'):
        shutil.copyfile(args.bundle / name, CONFIG_DIR / name)
        (CONFIG_DIR / name).chmod(0o600)
    for name in ('peticao-k3s.service', 'peticao-k3s-guard.service'):
        shutil.copyfile(args.bundle / name, UNIT_DIR / name)
        (UNIT_DIR / name).chmod(0o644)
    for name, value in [('agent-token', agent_token)] + ([('server-token', secrets.token_hex(32))] if args.node == 'santiago' else []):
        fd = os.open(CONFIG_DIR / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as stream:
            stream.write(value + '\n')
    Path('/var/lib/peticao-k3s').mkdir(mode=0o700)
    subprocess.run(['/usr/bin/systemctl', 'daemon-reload'], check=True, timeout=30)
    subprocess.run(['/usr/bin/systemctl', 'enable', '--now', 'peticao-k3s-guard.service'], check=True, timeout=30)
    subprocess.run(['/usr/bin/systemctl', 'enable', '--now', 'peticao-k3s.service'], check=True, timeout=210)
    print(json.dumps({'installed': args.node, 'backup': str(backup), 'qualification_complete': False}))


if __name__ == '__main__':
    main()
