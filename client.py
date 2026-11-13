#!/usr/bin/env python3
"""Freeze a reviewed packet and run one bounded SSH staging operation.

Apply/rollback require an independently acquired deploy lease from the existing
ledger. Tokens stay in the protected local record and never enter SSH arguments.
"""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parent
WORKSPACE = ROOT.parents[1]
SESSION = '01a1d130-2948-7140-bcfb-34696b20ab8d'
ACTOR = 'admin-recuperacao'
RESOURCE = 'deploy:akamai-development-coordinator-standby'
DELEGATION = WORKSPACE/'outbox/ROOT-SCOPED-RESUME-20261113.json'
LEDGER_SOURCE = Path('/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def git(*args):
    return subprocess.check_output(['git','-C',str(ROOT),*args],text=True).strip()


def prepare(output):
    if git('status','--porcelain'):
        raise ValueError('freeze all staging source before preparing the packet')
    scope=json.loads(DELEGATION.read_text())
    if scope['delegation']['session']!=SESSION or scope['delegation']['cooperativeAuthority']!=ACTOR or RESOURCE not in scope['delegation']['resources']:
        raise PermissionError('explicit scoped delegation missing')
    request=Path(scope['requestRead'])
    if digest(request.read_bytes())!=scope['requestSha256']:
        raise ValueError('delegation request evidence changed')
    files={p.name:p.read_bytes() for p in (ROOT/'runtime').glob('*.py')}
    files['standby.service']=(ROOT/'standby.service').read_bytes()
    packet={'commit':git('rev-parse','HEAD'),'operator_sha256':digest((ROOT/'operator.py').read_bytes()),
            'delegation_sha256':digest(DELEGATION.read_bytes()),
            'runtime':{name:base64.b64encode(data).decode() for name,data in files.items() if name!='standby.service'},
            'unit':base64.b64encode(files['standby.service']).decode(),
            'hashes':{name:digest(data) for name,data in files.items()}}
    with output.open('x') as f:json.dump(packet,f,sort_keys=True,indent=2)
    output.chmod(0o600)
    return {'commit':packet['commit'],'packet_sha256':digest(output.read_bytes()),'members':len(files)}


def validate_packet(path):
    packet=json.loads(path.read_text())
    if git('rev-parse','HEAD')!=packet['commit'] or git('status','--porcelain'):
        raise ValueError('reviewed source commit changed or is dirty')
    if digest((ROOT/'operator.py').read_bytes())!=packet['operator_sha256']:
        raise ValueError('operator changed after freeze')
    if digest(DELEGATION.read_bytes())!=packet['delegation_sha256']:
        raise ValueError('scoped delegation changed; review the new handoff')
    for name,encoded in packet['runtime'].items():
        if Path(name).name!=name:
            raise ValueError('runtime member must be a basename')
        actual=(ROOT/'runtime'/name)
        if actual.parent!=ROOT/'runtime' or actual.is_symlink() or not actual.is_file():
            raise ValueError('invalid runtime member')
        if digest(actual.read_bytes())!=packet['hashes'][name] or actual.read_bytes()!=base64.b64decode(encoded,validate=True):
            raise ValueError('runtime packet differs from reviewed source')
    if (ROOT/'standby.service').read_bytes()!=base64.b64decode(packet['unit'],validate=True):
        raise ValueError('unit differs from reviewed source')
    return packet


def ledger():
    spec=importlib.util.spec_from_file_location('infra_central_ledger',LEDGER_SOURCE)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Ledger()


def own_lease(path,packet_path,packet,central=None):
    info=path.lstat()
    if path.is_symlink() or info.st_uid!=os.getuid() or info.st_mode & 0o077:
        raise PermissionError('private own lease record required')
    record=json.loads(path.read_text())
    if record.get('operator_session')!=SESSION:
        raise PermissionError('not an Infra-owned lease record; root tokens cannot be reused')
    result=record['result']
    central=central if central is not None else ledger()
    central.check(ACTOR,result['lease'],result['token'],result['fence'])
    with central.db() as db:
        row=central.verify(db,ACTOR,result['lease'],result['token'],result['fence'])
        if row['operation']!='deploy' or RESOURCE not in json.loads(row['resources']):
            raise PermissionError('own critical deploy lease for the exact standby scope required')
        event=db.execute('SELECT * FROM events WHERE seq=?',(result['seq'],)).fetchone()
        if not event or event['kind']!='lease_acquired':
            raise ValueError('acquisition event missing')
        acquired=json.loads(event['data'])
        if acquired['lease']!=result['lease'] or acquired['fence']!=result['fence']:
            raise ValueError('acquisition identity mismatch')
        notice=db.execute('SELECT * FROM events WHERE seq=?',(acquired['manifest_event'],)).fetchone()
        data=json.loads(notice['data'])
        if data['manifest']['commit']!=packet['commit'] or data.get('packet_sha256')!=digest(packet_path.read_bytes()):
            raise ValueError('critical manifest does not bind this source and packet')
    return {'operator':'infra','session':SESSION,'actor':ACTOR,'lease':result['lease'],
            'fence':result['fence'],'manifest_event':acquired['manifest_event']}


def execute(action,packet_path,output,lease_path=None,central=None):
    packet=validate_packet(packet_path)
    request={'action':action,'packet':packet}
    if action in ['apply','rollback']:
        if lease_path is None:
            raise PermissionError('own validated critical lease is required')
        request['execution']=own_lease(lease_path,packet_path,packet,central)
    code=(ROOT/'operator.py').read_text()
    cmd=['ssh','-T','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=12',
         'cluster-akamai-root','python3 -c '+shlex.quote(code)]
    # Reserve the receipt path before any external action; never run first and
    # only then discover that the evidence file would overwrite another result.
    with output.open('x') as f:
        try:
            p=subprocess.run(cmd,input=json.dumps(request),capture_output=True,text=True,timeout=60)
            try:result=json.loads(p.stdout)
            except ValueError:result={'ok':False,'error':'remote_response_unreadable','transport_uncertain':True}
            result['ssh_exit']=p.returncode
        except subprocess.TimeoutExpired:
            result={'ok':False,'error':'ssh_timeout','transport_uncertain':True,'automatic_retry':False}
        except OSError as e:
            result={'ok':False,'error':type(e).__name__,'automatic_retry':False}
        result.update(action=action,commit=packet['commit'],packet_sha256=digest(packet_path.read_bytes()))
        json.dump(result,f,indent=2)
    output.chmod(0o600)
    return {'ok':result.get('ok'),'error':result.get('error'),'output':str(output),'action':action,
            'transport_uncertain':result.get('transport_uncertain',False)}


def main():
    os.umask(0o077)
    p=argparse.ArgumentParser(description=__doc__)
    sub=p.add_subparsers(dest='command',required=True)
    a=sub.add_parser('prepare');a.add_argument('--output',type=Path,required=True)
    a=sub.add_parser('run');a.add_argument('--packet',type=Path,required=True)
    a.add_argument('--action',choices=['preflight','apply','verify','rollback'],required=True)
    a.add_argument('--output',type=Path,required=True);a.add_argument('--lease-file',type=Path)
    a=p.parse_args()
    r=prepare(a.output) if a.command=='prepare' else execute(a.action,a.packet,a.output,a.lease_file)
    print(json.dumps(r))


if __name__=='__main__':main()
