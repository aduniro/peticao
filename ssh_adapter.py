"""Akamai-local SSH adapter: worker export never traverses the owner's Dell."""
import hashlib
import gzip
import ipaddress
import json
from pathlib import Path
import subprocess
import tarfile
from datetime import datetime, timezone


class Adapter:
    def __init__(self, root, receipt, *, ssh_key, known_hosts):
        self.root=Path(root);self.receipt=receipt
        address=ipaddress.ip_address(receipt['worker_tailnet_ip'])
        if address not in ipaddress.ip_network('100.64.0.0/10'):
            raise ValueError('Worker must use a verified tailnet address')
        self.command=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',
                      '-o','StrictHostKeyChecking=yes','-o','UserKnownHostsFile='+str(known_hosts),
                      '-i',str(ssh_key),'builder@'+str(address),
                      'sudo -n /usr/bin/python3 /usr/local/lib/peticao-civo/worker_lifecycle.py']

    def rpc(self,action,ident):
        result=subprocess.run(self.command,input=json.dumps({'action':action,'instance_id':ident}).encode(),
                              capture_output=True,timeout=60)
        if result.returncode:raise RuntimeError('Worker lifecycle RPC failed; admission stays closed')
        return json.loads(result.stdout)

    def drain(self,ident):self.rpc('drain',ident)
    def snapshot(self,ident):return self.rpc('snapshot',ident)
    def assert_frozen(self,ident,proof):
        result=self.rpc('assert-frozen',ident)
        if result.get('ok') is not True or result.get('instance_id') != ident:
            raise ValueError('Frozen worker identity not verified')

    def export_verified(self,resources):
        ident=next(r['id'] for r in resources if r['kind']=='instances')
        self.rpc('freeze',ident)
        path=self.root/'exports'/('worker-'+ident+'.tar.gz')
        path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        temporary=path.with_suffix('.partial')
        with open(temporary,'wb') as output:
            result=subprocess.run(self.command,input=json.dumps({'action':'export','instance_id':ident}).encode(),
                                  stdout=output,stderr=subprocess.PIPE,timeout=1800)
            output.flush()
            import os
            os.fsync(output.fileno())
        if result.returncode:raise RuntimeError('Worker export failed; source resources preserved')
        # Read every regular entry to force gzip/tar checks; never extract secrets
        # or trust names supplied by a remote archive as local filesystem paths.
        with tarfile.open(temporary,'r:gz') as archive:
            identity=None
            for entry in archive:
                parts=Path(entry.name).parts
                if not parts or parts[0]!='peticao-worker' or '..' in parts or entry.name.startswith('/'):
                    raise ValueError('Unsafe archive entry')
                if entry.isreg():
                    with archive.extractfile(entry) as handle:
                        if entry.name=='peticao-worker/control/identity.json':
                            if entry.size>16384 or identity is not None:raise ValueError('Invalid archived identity')
                            identity=json.loads(handle.read())
                        else:
                            while handle.read(1024*1024):pass
            if (not identity or identity.get('instance_id')!=ident
                    or sorted(identity.get('resource_ids',[]))!=sorted(r['id'] for r in resources)):
                raise ValueError('Backup does not attest all owned resource IDs')
        # tar EOF can precede the gzip trailer; verify the full compressed stream
        # before allowing any proof of preservation to authorize cleanup.
        with gzip.open(temporary,'rb') as handle:
            while handle.read(1024*1024):pass
        with open(temporary,'rb') as handle:digest=hashlib.file_digest(handle,'sha256').hexdigest()
        temporary.replace(path)
        directory=__import__('os').open(path.parent,__import__('os').O_DIRECTORY)
        try:__import__('os').fsync(directory)
        finally:__import__('os').close(directory)
        return dict(instance_id=ident,worker_frozen=True,sha256_verified=True,
                    resource_ids=sorted(r['id'] for r in resources),backup_path=str(path),
                    sha256=digest,verified_at=datetime.now(timezone.utc).isoformat())
