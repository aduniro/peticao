"""Freeze/lease gate for one isolated Civo qualification attempt."""
import argparse
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import time

BASE = Path(__file__).resolve().parent
COORD = '/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
REMOTE = '/mnt/apps/peticao-final/.runtime/civo-qualification-c472-20261114-attempt1'
TARGET = 'cluster-civo-root-ipv4'


def cli(args):
    p = subprocess.run(['python3', COORD, *args], capture_output=True, text=True, timeout=30)
    x = json.loads(p.stdout)
    if p.returncode or not x.get('ok'):
        raise RuntimeError('Canonical operation rejected')
    return x['result']


def gate(args):
    cap = json.loads(Path(args.lease_file).read_text())['result']
    cli(['check', '--actor', 'admin-recuperacao', '--lease', cap['lease'], '--token', cap['token'], '--fence', str(cap['fence'])])
    lease = next(x for x in cli(['status'])['leases'] if x['id'] == cap['lease'])
    if lease['operation'] != 'test' or 'coord:civo-c472-worker-qualification' not in lease['resources'] or lease['expires'] - time.time() < 300:
        raise ValueError('Own exact qualification test lease with time remaining required')
    history = cli(['history', '--after-seq', str(args.manifest_event - 1), '--limit', '1'])
    notice = history[0]
    if notice['seq'] != args.manifest_event or notice['kind'] != 'notice':
        raise ValueError('Wrong immutable notice')
    # Test operations do not require a manifest in coord.py; this caller does.
    if lease.get('manifest_event') not in (None, args.manifest_event):
        raise ValueError('Wrong lease manifest')
    acquisition = cli(['history', '--after-seq', str(cap['seq'] - 1), '--limit', '1'])[0]
    if acquisition['data'].get('manifest_event') != args.manifest_event:
        raise ValueError('Test lease is not bound to this manifest')
    data = notice['data']
    head = subprocess.check_output(['git', '-C', str(BASE), 'rev-parse', 'HEAD'], text=True).strip()
    if head != data['manifest']['commit']:
        raise ValueError('Source commit changed')
    for name, sha in data['file_sha256'].items():
        p = BASE / name
        if Path(name).name != name or p.is_symlink() or hashlib.sha256(p.read_bytes()).hexdigest() != sha:
            raise ValueError('Reviewed source changed')
    # Independent peer ACK is explicit even for the non-publication test phase.
    events = cli(['history', '--after-seq', str(args.manifest_event), '--limit', '200'])
    if not any(e['kind'] == 'ack' and e['actor'] == 'apoio' and e['data'].get('event_seq') == args.manifest_event for e in events):
        raise ValueError('Independent Apoio ACK not found')
    return data


def ssh(command, data=None):
    return subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ControlPath=none', '-o', 'ConnectTimeout=12', TARGET, command], input=data, capture_output=True, timeout=180)


def main(args):
    gate(args)
    policy = json.loads((BASE / 'policy.json').read_text())
    if args.phase == 'stage':
        journal = BASE / 'STAGE-ATTEMPT.json'
        if journal.exists():
            raise ValueError('Stage already attempted; inspect remote state before any reviewed retry')
        for item in policy['inputs'].values():
            h = hashlib.sha256()
            with Path(item['path']).open('rb') as stream:
                for block in iter(lambda: stream.read(1048576), b''): h.update(block)
            if h.hexdigest() != item['sha256']:
                raise ValueError('Public input changed before transfer')
        journal.write_text(json.dumps(dict(at=time.time(), state='submitting', manifest=args.manifest_event)) + '\n')
        gate(args)
        parent = str(Path(REMOTE).parent)
        command = ('set -eu; umask 077; if ! test -e ' + parent + '; then mkdir ' + parent + '; chmod 0755 ' + parent + '; fi; '
                   'runuser -u civo -- test -x ' + parent + '; test ! -e ' + REMOTE + '; mkdir -p ' + REMOTE + '/inputs')
        p = ssh(command)
        if p.returncode: raise RuntimeError('Remote attempt already exists or mkdir failed')
        files = [(BASE / 'runner.py', REMOTE + '/runner.py'), (BASE / 'policy.json', REMOTE + '/inputs/policy.json')]
        files += [(Path(item['path']), REMOTE + '/inputs/' + name) for name, item in policy['inputs'].items()]
        for path, destination in files:
            gate(args)
            p = subprocess.run(['scp', '-o', 'BatchMode=yes', '-o', 'ControlPath=none', str(path), TARGET + ':' + destination], capture_output=True, timeout=600)
            if p.returncode: raise RuntimeError('Stage transfer failed; preserve partial attempt')
        journal.write_text(json.dumps(dict(at=time.time(), state='staged', manifest=args.manifest_event)) + '\n')
        print(json.dumps(dict(staged=True, files=len(files), credential_files=0)))
        return
    gate(args)
    expected = {REMOTE + '/runner.py': hashlib.sha256((BASE / 'runner.py').read_bytes()).hexdigest(),
                REMOTE + '/inputs/policy.json': hashlib.sha256((BASE / 'policy.json').read_bytes()).hexdigest()}
    verifier = 'import hashlib,pathlib,subprocess; expected=' + repr(expected) + '; assert all(hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest()==s for p,s in expected.items()); raise SystemExit(subprocess.call(["python3",' + repr(REMOTE + '/runner.py') + ',' + repr(args.phase) + ']))'
    command = 'python3 -c ' + shlex.quote(verifier)
    p = ssh(command)
    (BASE / ('REMOTE-' + args.phase + '.private.log')).write_bytes(p.stderr)
    if p.returncode:
        print(p.stdout.decode(errors='replace')[-500:])
        raise RuntimeError('Remote phase failed; preserve and diagnose before retry')
    result = json.loads(p.stdout)
    (BASE / ('RESULT-' + args.phase + '.json')).write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--lease-file', required=True)
    parser.add_argument('--manifest-event', required=True, type=int)
    parser.add_argument('--phase', choices=['stage', 'prepare', 'build', 'status'], required=True)
    try: main(parser.parse_args())
    except Exception as error:
        print('Civo qualification caller failed: ' + type(error).__name__)
        raise SystemExit(1)
