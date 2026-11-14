"""Restore owner-authorized project credentials to civo; never print values."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path
import pwd
import stat
import subprocess
import tarfile
import tempfile


def safe_path(root,relative):
    path=Path(relative)
    if path.is_absolute() or '..' in path.parts:raise ValueError('Unsafe restore path')
    current=root
    for part in path.parts:
        current=current/part
        if current.is_symlink():raise ValueError('Restore symlink refused')
    return current


def restore(folder,key_file,user):
    if os.geteuid()!=0 or user!='civo':raise ValueError('Root restore for civo required')
    entry=pwd.getpwnam(user);home=Path(entry.pw_dir)
    if home!=Path('/home/civo') or home.is_symlink():raise ValueError('Unexpected home')
    key=Path(key_file);info=key.lstat()
    if not stat.S_ISREG(info.st_mode) or key.is_symlink() or info.st_mode&0o077:
        raise ValueError('Unlock key must be a private regular file')
    folder=Path(folder);manifest=json.loads((folder/'MANIFEST.json').read_text())
    payload=folder/'credentials.tar.gpg'
    if hashlib.sha256(payload.read_bytes()).hexdigest()!=manifest['encrypted_payload_sha256']:
        raise ValueError('Encrypted payload differs from manifest')
    with tempfile.TemporaryDirectory(prefix='restore-gpg-',dir=folder) as gnupg:
        os.chmod(gnupg,0o700)
        try:
            result=subprocess.run(['gpg','--homedir',gnupg,'--batch','--no-symkey-cache',
                                   '--pinentry-mode','loopback','--passphrase-file',str(key),
                                   '--decrypt',str(payload)],capture_output=True)
        finally:
            subprocess.run(['gpgconf','--homedir',gnupg,'--kill','gpg-agent'],
                           stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if result.returncode:raise ValueError('Authenticated credential decryption failed')
    expected={x['target']:x for x in manifest['credentials']}
    with tarfile.open(fileobj=io.BytesIO(result.stdout)) as archive:
        members=archive.getmembers()
        if len(members)!=len(expected) or {x.name for x in members}!=set(expected):
            raise ValueError('Credential archive inventory mismatch')
        # Validate every member before changing the target home.
        for member in members:
            if not member.isfile():raise ValueError('Only regular credential files allowed')
            safe_path(home,member.name)
            if hashlib.sha256(archive.extractfile(member).read()).hexdigest()!=expected[member.name]['sha256']:
                raise ValueError('Credential source checksum mismatch')
        installed=[]
        for member in members:
            target=safe_path(home,member.name);raw=archive.extractfile(member).read()
            # Path remapping only in config files, never modify key/token bytes.
            if member.name in ['.ssh/config','.ssh/config_peticao_tailnet_v2',
                               '.ssh/config_akamai_worker_20261112','.ssh/config_admin_mesh',
                               '.oci/peticao-oracle/config']:
                raw=raw.replace(b'/home/barre/',b'/home/civo/')
            parent=target.parent
            parent.mkdir(parents=True,exist_ok=True,mode=0o700)
            for part in [parent,*parent.parents]:
                if part==home:break
                os.chown(part,entry.pw_uid,entry.pw_gid);os.chmod(part,0o700)
            if target.exists():
                if not target.is_file():raise ValueError('Existing target is not regular')
                if target.read_bytes()==raw:
                    os.chown(target,entry.pw_uid,entry.pw_gid);os.chmod(target,0o600);continue
                backup=folder/'pre-existing';backup.mkdir(mode=0o700,exist_ok=True)
                backup_file=backup/hashlib.sha256(str(target).encode()).hexdigest()
                if backup_file.exists():raise ValueError('Existing credential changed twice; inspect backup')
                backup_file.write_bytes(target.read_bytes());backup_file.chmod(0o600)
            fd,tmp=tempfile.mkstemp(prefix='.peticao-restore-',dir=parent)
            try:
                with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
                os.chown(tmp,entry.pw_uid,entry.pw_gid);os.chmod(tmp,0o600);os.replace(tmp,target)
            finally:
                if os.path.exists(tmp):os.unlink(tmp)
            installed.append(member.name)
    # Does not alter authorized_keys, server host keys, SSHD or firewalls.
    receipt=dict(restored_files=len(expected),new_or_changed_files=len(installed),
                 user=user,permissions='0600 files / 0700 directories',secret_values_logged=False)
    (folder/'CREDENTIAL-RESTORE-RESULT.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--folder',required=True)
    parser.add_argument('--key-file',required=True);parser.add_argument('--user',default='civo')
    args=parser.parse_args()
    try:restore(args.folder,args.key_file,args.user)
    except Exception as error:
        print('Credential restore failed: '+type(error).__name__)
        raise SystemExit(1)
