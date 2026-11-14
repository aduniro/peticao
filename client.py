#!/usr/bin/env python3
"""Reviewed, lease-bound private checkpoint transfer and passive restore."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import shlex
import subprocess
import time
import selectors
import sys

ROOT = Path(__file__).resolve().parent
COORD = '/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py'
SESSION = '01a1d130-2948-7140-bcfb-34696b20ab8d'
RESOURCE = 'deploy:civo-development-passive-restore'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def central(args):
    p = subprocess.run(['python3', COORD, *args], capture_output=True, text=True, timeout=30)
    result = json.loads(p.stdout)
    if p.returncode or not result.get('ok'):
        raise PermissionError('canonical ledger rejected operation')
    return result['result']


def git(*args):
    return subprocess.check_output(['git', '-C', str(ROOT), *args], text=True).strip()


def source_hashes():
    files = subprocess.check_output(['git', '-C', str(ROOT), 'ls-files', '-z']).decode().split('\0')
    result = {}
    for name in filter(None, files):
        p = ROOT / name
        if p.is_symlink() or not p.is_file():
            raise ValueError('source must contain regular files only')
        result[name] = sha(p.read_bytes())
    return result


def validate_lease(path, manifest_event, operation='migration'):
    info = path.lstat()
    if path.is_symlink() or info.st_uid != os.getuid() or info.st_mode & 0o077:
        raise PermissionError('private own lease file required')
    record = json.loads(path.read_text())
    if record.get('operator_session') != SESSION:
        raise PermissionError('Infra session-owned capability required')
    cap = record['result']
    central(['check', '--actor', 'admin-recuperacao', '--lease', cap['lease'], '--token', cap['token'], '--fence', str(cap['fence'])])
    status = central(['status'])
    lease = next(x for x in status['leases'] if x['id'] == cap['lease'])
    if lease['actor'] != 'admin-recuperacao' or lease['operation'] != operation or RESOURCE not in lease['resources'] or lease['expires'] - time.time() < 180:
        raise PermissionError('exact own deploy reservation and time margin required')
    acquisition = central(['history', '--after-seq', str(cap['seq'] - 1), '--limit', '1'])[0]
    if acquisition['kind'] != 'lease_acquired' or acquisition['data'].get('manifest_event') != manifest_event or acquisition['data'].get('lease') != cap['lease']:
        raise PermissionError('lease acquisition is not bound to this manifest')
    return {'operator': 'infra', 'session': SESSION, 'actor': 'admin-recuperacao', 'lease': cap['lease'],
            'fence': cap['fence'], 'manifest_event': manifest_event}


def reviewed(manifest_event):
    if git('status', '--porcelain'):
        raise ValueError('reviewed source has changes')
    notice = central(['history', '--after-seq', str(manifest_event - 1), '--limit', '1'])[0]
    if notice['seq'] != manifest_event or notice['kind'] != 'notice':
        raise ValueError('immutable notice required')
    data = notice['data']
    if data['manifest']['commit'] != git('rev-parse', 'HEAD') or data['file_sha256'] != source_hashes():
        raise ValueError('reviewed manifest does not match source')
    cursor = manifest_event
    acknowledged = False
    while True:
        events = central(['history', '--after-seq', str(cursor), '--limit', '200'])
        if not events:
            break
        acknowledged |= any(e['kind'] == 'ack' and e['actor'] == 'apoio' and e['data'].get('event_seq') == manifest_event for e in events)
        cursor = events[-1]['seq']
        if len(events) < 200:
            break
    if not acknowledged:
        raise PermissionError('independent Apoio ACK required')
    return data


KEY=ROOT.parent/'civo-owner-bundle-20261114/unlock.key'
STATE=ROOT/'state'
MUTATING={'capture','encrypt','transfer','restore'}


def request(role,action):
    return {'role':role,'action':action,'policy':json.loads((ROOT/'policy.json').read_text()),
            'helper':(ROOT/'checkpoint.py').read_text(),'probe':(ROOT/'probe.py').read_text()}


def ssh_argv(payload):
    host={'source':'cluster-santiago-root-ipv4','target':'cluster-civo-root-ipv4'}[payload['role']]
    code=(ROOT/'operator.py').read_text()
    command='python3 -c '+shlex.quote(code)+' '+shlex.quote(json.dumps(payload,separators=(',',':')))
    return ['ssh','-T','-o','BatchMode=yes','-o','ControlPath=none','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12',host,command]


def save_new(path,value):
    with path.open('x') as stream:json.dump(value,stream,indent=2)
    path.chmod(0o600)


def remote(payload,label,body=None,timeout=180):
    # Reserve an intent before any network action; never replay a mutation after
    # a timeout merely because its response was lost.
    save_new(STATE/(label+'.intent.json'),{'role':payload['role'],'action':payload['action'],'at':time.time()})
    try:
        result=subprocess.run(ssh_argv(payload),input=body,capture_output=True,timeout=timeout)
        (STATE/(label+'.stderr.private.log')).write_bytes(result.stderr)
        if result.returncode:
            save_new(STATE/(label+'.result.json'),{'ok':False,'ssh_exit':result.returncode,'observation':'remote failure; inspect retained state before retry'})
            raise RuntimeError('remote phase failed; see private evidence')
        value=json.loads(result.stdout)
        save_new(STATE/(label+'.result.json'),value)
        if not value.get('ok'):raise RuntimeError('remote result rejected')
        return value['result']
    except subprocess.TimeoutExpired:
        save_new(STATE/(label+'.result.json'),{'ok':False,'transport_uncertain':True,'automatic_retry':False})
        raise


def capture_receipt():
    value=json.loads((STATE/'capture.result.json').read_text())
    data=value['result']
    if not value.get('ok') or data['bytes']>512*1024**2:
        raise ValueError('successful bounded capture receipt required')
    return data


def hash_stdout(proc,timeout):
    deadline=time.monotonic()+timeout;h=hashlib.sha256();size=0
    selector=selectors.DefaultSelector();selector.register(proc.stdout,selectors.EVENT_READ)
    try:
        while True:
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('decrypt observation timed out')
            if not selector.select(remaining):raise TimeoutError('decrypt output timed out')
            chunk=os.read(proc.stdout.fileno(),65536)
            if not chunk:break
            size+=len(chunk)
            if size>512*1024**2:raise ValueError('plaintext limit exceeded')
            h.update(chunk)
        if proc.wait(timeout=max(1,deadline-time.monotonic())):
            raise RuntimeError('local authenticated decryption rejected')
        return h.hexdigest(),size
    finally:
        selector.close()
        if proc.poll() is None:proc.kill();proc.wait()
        proc.stdout.close()


def encrypt_capture():
    meta=capture_receipt()
    if KEY.is_symlink() or not KEY.is_file() or KEY.stat().st_uid!=os.getuid() or KEY.stat().st_mode&0o077:
        raise PermissionError('existing private owner-controlled transport key required')
    gpg=STATE/'gpg';tmp=STATE/'tmp';gpg.mkdir(mode=0o700);tmp.mkdir(mode=0o700)
    cipher=STATE/'checkpoint.tar.gpg'
    if cipher.exists():raise FileExistsError('never overwrite encrypted checkpoint')
    payload=request('source','read');payload['capture']=meta
    environment={'PATH':'/usr/bin:/bin','TMPDIR':str(tmp)}
    base=['gpg','--homedir',str(gpg),'--batch','--no-symkey-cache','--pinentry-mode','loopback','--passphrase-file',str(KEY)]
    try:
        with (STATE/'encrypt-source.stderr.private.log').open('xb') as source_error,(STATE/'encrypt-gpg.stderr.private.log').open('xb') as crypto_error:
            source=subprocess.Popen(ssh_argv(payload),stdout=subprocess.PIPE,stderr=source_error)
            process=subprocess.Popen(base+['--symmetric','--cipher-algo','AES256','--s2k-digest-algo','SHA512','--s2k-count','65011712','--output',str(cipher)],stdin=source.stdout,stdout=subprocess.DEVNULL,stderr=crypto_error,env=environment)
            source.stdout.close()
            try:
                if process.wait(timeout=300) or source.wait(timeout=30):
                    raise RuntimeError('encrypted transfer stream failed')
            finally:
                for child in [process,source]:
                    if child.poll() is None:child.kill();child.wait()
        cipher.chmod(0o600)
        with (STATE/'roundtrip-gpg.stderr.private.log').open('xb') as crypto_error:
            process=subprocess.Popen(base+['--decrypt',str(cipher)],stdout=subprocess.PIPE,stderr=crypto_error,env=environment)
            plain_sha,size=hash_stdout(process,120)
        if plain_sha!=meta['sha256'] or size!=meta['bytes']:
            raise ValueError('encrypted checkpoint roundtrip differs from source custody')
        value={'cipher_sha256':sha(cipher.read_bytes()),'cipher_bytes':cipher.stat().st_size,
               'plaintext_sha256':plain_sha,'roundtrip_verified':True,'plaintext_local_file_saved':False}
        save_new(STATE/'ENCRYPTION.json',value);return value
    finally:
        subprocess.run(['gpgconf','--homedir',str(gpg),'--kill','gpg-agent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)


def gate(args,budget=180):
    reviewed(args.manifest_event)
    if args.phase in MUTATING:
        cap=validate_lease(args.lease_file,args.manifest_event)
        lease=next(l for l in central(['status'])['leases'] if l['id']==cap['lease'])
        if lease['expires']-time.time()<budget+120:
            raise PermissionError('renew own lease before bounded phase budget')
    return True


def execute(args):
    gate(args,600 if args.phase in {'capture','encrypt','transfer'} else 180)
    if args.phase in MUTATING:
        save_new(STATE/(args.phase+'.phase-intent.json'),{'at':time.time(),'manifest':args.manifest_event,'phase':args.phase})
    if args.phase.startswith('preflight-'):
        role=args.phase.split('-',1)[1];value=remote(request(role,'preflight'),args.phase,timeout=60)
    elif args.phase=='capture':value=remote(request('source','capture'),'capture',timeout=600)
    elif args.phase=='encrypt':value=encrypt_capture()
    elif args.phase=='transfer':
        encryption=json.loads((STATE/'ENCRYPTION.json').read_text());meta=capture_receipt()
        remote(request('target','prepare'),'target-prepare',timeout=60)
        gate(args,480)
        payload=request('target','receive');payload.update(kind='cipher',cipher_sha256=encryption['cipher_sha256'])
        cipher=STATE/'checkpoint.tar.gpg'
        if sha(cipher.read_bytes())!=encryption['cipher_sha256']:raise ValueError('local ciphertext changed')
        remote(payload,'target-cipher',body=cipher.read_bytes(),timeout=300)
        gate(args,180)
        payload=request('target','receive');payload.update(kind='unlock')
        try:
            remote(payload,'target-unlock',body=KEY.read_bytes(),timeout=60)
            payload=request('target','decrypt');payload.update(capture=meta,cipher_sha256=encryption['cipher_sha256'])
            value=remote(payload,'target-decrypt',timeout=180)
        finally:
            # Only our temporary unlock copy, inside the private attempt path.
            cleanup=request('target','remove-unlock')
            remote(cleanup,'target-unlock-cleanup',timeout=60)
    elif args.phase in {'restore','verify'}:
        payload=request('target',args.phase);payload['capture']=capture_receipt()
        value=remote(payload,args.phase,timeout=180)
    elif args.phase=='capture-status':value=remote(request('source','capture-status'),'capture-status',timeout=60)
    else:raise ValueError('unsupported bounded phase')
    return {'phase':args.phase,'ok':True,'result':value}


if __name__=='__main__':
    os.umask(0o077)
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase',choices=['preflight-source','preflight-target','capture','capture-status','encrypt','transfer','restore','verify'])
    parser.add_argument('--manifest-event',type=int,required=True)
    parser.add_argument('--lease-file',type=Path)
    args=parser.parse_args()
    if args.phase in MUTATING and args.lease_file is None:raise SystemExit('own private migration lease required')
    value=execute(args)
    print(json.dumps({'ok':value['ok'],'phase':value['phase']}))

