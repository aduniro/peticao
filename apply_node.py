"""Root receiver for the exact reviewed SSH mesh policy; no private values stdout."""
import base64
import hashlib
import json
import os
from pathlib import Path
import pwd
import socket
import subprocess
import sys
import tempfile

from network_rules import authorization,client_config,known_hosts,listener_config,validate_key


def run(command):
    r=subprocess.run(command,capture_output=True,text=True,timeout=30)
    if r.returncode:raise RuntimeError('Bound command failed: '+command[0])
    return r.stdout


def atomic(path,raw,uid,gid,backup):
    path=Path(path)
    for p in [path,*path.parents]:
        if p.is_symlink():raise ValueError('Symlink target refused')
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    if path.exists():
        old=path.read_bytes()
        if old==raw:return False
        save=backup/hashlib.sha256(str(path).encode()).hexdigest()
        if not save.exists():save.write_bytes(old);save.chmod(0o600)
    fd,name=tempfile.mkstemp(prefix='.mesh-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        os.chown(name,uid,gid);os.chmod(name,0o600);os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)
    return True


def apply(envelope):
    if os.geteuid()!=0:raise ValueError('Root receiver required')
    policy=envelope['policy'];name=envelope['node']
    node=next(x for x in policy['nodes'] if x['name']==name)
    state=json.loads(run(['tailscale','status','--json']))
    if state.get('BackendState')!='Running' or node['ipv4'] not in state['Self']['TailscaleIPs']:
        raise ValueError('Authenticated node identity differs')
    operation=envelope['operation']
    if not isinstance(operation,int) or operation<1:raise ValueError('Operation receipt required')
    backup=Path('/var/lib/peticao-mesh-v3')/str(operation)
    backup.mkdir(parents=True,exist_ok=True,mode=0o700);backup.chmod(0o700)
    mapping={x['ipv4']:x['ipv6'] for x in policy['nodes']}
    civo=next(x for x in policy['nodes'] if x['name']=='civo')
    additions=[]
    for n in (policy['nodes'] if name=='civo' else [civo]):
        for a in n['accounts']:
            additions.append(dict(key=a['client_public'],sources=[n['ipv4'],n['ipv6']],
                                  label='mesh-'+n['name']+'-'+a['user']))
    if name=='civo':
        local=next(x for x in policy['nodes'] if x['name']=='local')
        additions.append(dict(key=policy['owner_civo_public'],
                              sources=[local['ipv4'],local['ipv6'],*policy['owner_public_addresses']],
                              label='owner-civo-existing'))
    # Validate every expected current auth/config digest before writing any file.
    for account in node['accounts']:
        entry=pwd.getpwnam(account['user']);home=Path(entry.pw_dir)
        if str(home)!=account['home']:raise ValueError('Account home changed')
        target=home/'.ssh'/('authorized_keys_peticao_tailnet_v2' if node['port']==2224 else 'authorized_keys')
        if str(target)!=account['auth_file'] or target.is_symlink():raise ValueError('Auth path changed')
        current=target.read_bytes() if target.exists() else b''
        expected=account['auth_sha256']
        if hashlib.sha256(current).hexdigest() not in {expected,account.get('auth_new_sha256')}:
            raise ValueError('Auth file changed since reviewed snapshot')
    if node.get('config'):
        cfg=Path(node['config'])
        if cfg.is_symlink() or hashlib.sha256(cfg.read_bytes()).hexdigest() not in {node['config_sha256'],node.get('config_new_sha256')}:
            raise ValueError('Dedicated SSH configuration changed')
        state=subprocess.run(['systemctl','is-active',node['service']],capture_output=True,text=True).stdout.strip()
        if state!='active' and not (name=='local' and node.get('start_existing_mesh_service') is True):
            raise ValueError('Dedicated mesh service is not active')
    changes=[]
    for account in node['accounts']:
        entry=pwd.getpwnam(account['user']);home=Path(entry.pw_dir);ssh=home/'.ssh'
        ssh.mkdir(mode=0o700,exist_ok=True);os.chown(ssh,entry.pw_uid,entry.pw_gid);ssh.chmod(0o700)
        if name=='civo':
            role='root' if account['user']=='root' else 'user'
            raw=base64.b64decode(envelope['client_private'][role],validate=True)
            if hashlib.sha256(raw).hexdigest()!=account['private_sha256']:raise ValueError('Client key digest differs')
            identity=Path(account['client_identity'])
            if identity.parent!=ssh:raise ValueError('Client key path differs')
            atomic(identity,raw,entry.pw_uid,entry.pw_gid,backup)
            atomic(str(identity)+'.pub',(account['client_public']+'\n').encode(),entry.pw_uid,entry.pw_gid,backup)
            actual=run(['ssh-keygen','-y','-P','','-f',str(identity)])
            if validate_key(actual)!=validate_key(account['client_public']):raise ValueError('Client pair mismatch')
        auth=Path(account['auth_file']);old=auth.read_text() if auth.exists() else ''
        new=authorization(old,mapping,additions)
        if atomic(auth,new.encode(),entry.pw_uid,entry.pw_gid,backup):changes.append(str(auth))
        atomic(ssh/'known_hosts_peticao_mesh_v3',known_hosts(policy['nodes']).encode(),entry.pw_uid,entry.pw_gid,backup)
        atomic(ssh/'config_peticao_mesh_v3',client_config(policy['nodes'],account['client_identity']).encode(),entry.pw_uid,entry.pw_gid,backup)
        main=ssh/'config';old=main.read_text() if main.exists() else ''
        include='Include '+str(ssh/'config_peticao_mesh_v3')
        if include not in old:atomic(main,(include+'\n'+old).encode(),entry.pw_uid,entry.pw_gid,backup)
    reloaded=False
    if node.get('config'):
        if name=='local' and node.get('start_existing_mesh_service') is True:
            # Existing dedicated service22xx, not the desktop's SSH22 socket or TS SSH.
            privsep=Path('/run/sshd')
            if privsep.is_symlink():raise ValueError('Unexpected privilege separation path')
            privsep.mkdir(mode=0o755,exist_ok=True);os.chown(privsep,0,0);privsep.chmod(0o755)
        cfg=Path(node['config']);old=cfg.read_bytes();new=listener_config(old.decode(),node['ipv6'],node['port']).encode()
        if new!=old:
            atomic(cfg,new,0,0,backup)
            try:run(['/usr/sbin/sshd','-t','-f',str(cfg)])
            except Exception:
                atomic(cfg,old,0,0,backup);raise
            # HUP only the dedicated mesh master; accepted sessions and public SSH remain.
            state=subprocess.run(['systemctl','is-active',node['service']],capture_output=True,text=True).stdout.strip()
            if state=='active':run(['systemctl','kill','--kill-whom=main','--signal=HUP',node['service']])
            else:run(['systemctl','start',node['service']])
            reloaded=True
        elif name=='local' and node.get('start_existing_mesh_service') is True:
            run(['/usr/sbin/sshd','-t','-f',str(cfg)])
            run(['systemctl','start',node['service']]);reloaded=True
    prefs=json.loads(run(['tailscale','debug','prefs']))
    if prefs.get('CorpDNS') is False:
        try:
            resolved={x[4][0] for x in socket.getaddrinfo(civo['dns'],22,type=socket.SOCK_STREAM)}
            magic_works=bool(resolved & {civo['ipv4'],civo['ipv6']})
        except socket.gaierror:magic_works=False
        if not magic_works:run(['tailscale','set','--accept-dns=true'])
    receipt=dict(node=name,operation=operation,authorization_files_changed=changes,
                 dedicated_listener_hup=reloaded,private_values_logged=False,
                 passwords_changed=False,host_keys_changed=False,production_database_changed=False)
    (backup/'RESULT.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))


if __name__=='__main__':
    os.umask(0o077)
    try:apply(json.load(sys.stdin))
    except Exception as error:
        print('Mesh receiver failed: '+type(error).__name__)
        raise SystemExit(1)
