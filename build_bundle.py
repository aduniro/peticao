"""Owner-authorized export. Values are streamed into encryption, never stdout."""
from pathlib import Path
import hashlib
import io
import json
import os
import secrets
import stat
import subprocess
import tarfile

BASE=Path(__file__).resolve().parent
PROJECT=Path('/mnt/apps/peticao-final')
ORIGIN=Path('/home/barre')
KEY=BASE/'unlock.key'
OUTPUT=PROJECT/'peticao-civo-bootstrap-completo.tar.gz'


def build():
    os.umask(0o077)
    if OUTPUT.exists() or KEY.exists():raise ValueError('Refusing to overwrite an existing bundle/key')
    files={}
    def include(source,target=None,purpose='project credential'):
        source=Path(source)
        if not source.exists():return
        target=target or source.relative_to(ORIGIN).as_posix()
        # Existing Kaggle setup intentionally aliases these two scoped files.
        if source==ORIGIN/'.kaggle/access_token' and source.is_symlink():
            if source.resolve()!=ORIGIN/'.kaggle/peticao-kaggle':raise ValueError('Unexpected Kaggle alias')
            source=source.resolve()
        info=source.lstat()
        if not stat.S_ISREG(info.st_mode) or source.is_symlink():raise ValueError('Non-regular source refused')
        if target.startswith('/') or '..' in Path(target).parts:raise ValueError('Unsafe archive target')
        files[target]=(source,purpose)
    # Canonical provider stores, not personal browser/Codex caches or application A1 data.
    for source in sorted((ORIGIN/'.config/peticao/credentials').iterdir()):
        if source.is_file():include(source,purpose='provider API token / existing Tailscale auth key')
    for name in ['.config/peticao-infra/keys.env','.config/scw/config.yaml',
                 '.config/linode-cli','.kaggle/access_token','.kaggle/peticao-kaggle',
                 '.oci/peticao-oracle/config','.oci/peticao-oracle/peticao-oracle.pem',
                 '.aws/config','.aws/credentials','.config/gh/config.yml','.config/gh/hosts.yml',
                 '.config/neon/credentials.peticao-coordenacao.json','.config/neon/profiles.json',
                 '.ovh.conf']:
        include(ORIGIN/name)
    for source in sorted((ORIGIN/'.ssh').iterdir()):
        name=source.name
        if (name.startswith(('id_peticao','id_ed25519_peticao','id_admin_v2','id_sonda_verifica3'))
                or name in ['id_ed25519_civo','id_ed25519_civo.pub','config',
                            'config_peticao_tailnet_v2','config_akamai_worker_20261112','config_admin_mesh',
                            'known_hosts_peticao_tailnet_v2','known_hosts_admin_mesh']):
            include(source,purpose='project SSH client identity/configuration')
    if not files:raise ValueError('No scoped credential sources')
    stream=io.BytesIO();metadata=[]
    with tarfile.open(fileobj=stream,mode='w') as archive:
        for target,(source,purpose) in sorted(files.items()):
            # Opaque bytes: no printing, parsing, shell expansion or auth calls.
            raw=source.read_bytes()
            item=tarfile.TarInfo(target);item.size=len(raw);item.mode=0o600
            archive.addfile(item,io.BytesIO(raw))
            metadata.append(dict(source=str(source),target=target,purpose=purpose,
                                 source_mode=oct(source.stat().st_mode&0o777),restore_mode='0600',
                                 sha256=hashlib.sha256(raw).hexdigest()))
    KEY.write_text(secrets.token_urlsafe(48)+'\n');KEY.chmod(0o600)
    gnupg=BASE/'gpg-home';gnupg.mkdir(mode=0o700)
    encrypted=BASE/'credentials.tar.gpg'
    command=['gpg','--homedir',str(gnupg),'--batch','--pinentry-mode','loopback',
             '--passphrase-file',str(KEY),'--symmetric','--cipher-algo','AES256',
             '--s2k-digest-algo','SHA512','--s2k-count','65011712','--output',str(encrypted)]
    with (BASE/'crypto.private.log').open('wb') as log:
        subprocess.run(command,input=stream.getvalue(),stdout=log,stderr=log,check=True)
    # Authenticated decryption must reproduce all bytes before distribution.
    check=subprocess.run(['gpg','--homedir',str(gnupg),'--batch','--pinentry-mode','loopback',
                          '--passphrase-file',str(KEY),'--decrypt',str(encrypted)],capture_output=True,check=True)
    if not secrets.compare_digest(hashlib.sha256(check.stdout).digest(),hashlib.sha256(stream.getvalue()).digest()):
        raise ValueError('Encrypted round-trip mismatch')
    bootstrap=PROJECT/'bootstrap-peticao-civo.sh'
    expected='5d2033553d5b356893fe3305cdd477fc5b40b5b596e987b589731004b28aac3f'
    if hashlib.sha256(bootstrap.read_bytes()).hexdigest()!=expected:raise ValueError('Reviewed bootstrap changed')
    manifest=dict(target_instance='3d6e5117-e1db-4e7f-b97e-967a3ab91f0f',
                  account_id='dbe38aec-d8fa-4f41-b745-0471257e0594',region='NYC1',
                  host='peticao-civo',user='civo',public_ipv4='212.2.241.70',
                  os='Ubuntu24.04LTS',bootstrap_sha256=expected,credentials=metadata,
                  credential_files=len(metadata),cipher='GnuPG AES256 symmetric + integrity protection',
                  encrypted_payload_sha256=hashlib.sha256(encrypted.read_bytes()).hexdigest(),
                  unlock_key_inside_archive=False,crypto_round_trip_pass=True,
                  excluded=['Codex/OpenAI auth','coordination lease capabilities','A1 signing material',
                            'server SSH host private keys','browser cookies','AWS login session cache'],
                  limitations=['OVH config absent if not listed','Provider authentication validity not assumed',
                               'CLI installation and copied credentials do not imply all services authenticated'])
    m=BASE/'MANIFEST.json';m.write_text(json.dumps(manifest,indent=2)+'\n')
    members={'bootstrap.sh':bootstrap,'credentials.tar.gpg':encrypted,'MANIFEST.json':m,
             'restore_credentials.py':BASE/'restore_credentials.py'}
    checksums=''.join(hashlib.sha256(path.read_bytes()).hexdigest()+'  '+name+'\n' for name,path in members.items())
    checksum=BASE/'SHA256SUMS';checksum.write_text(checksums);members['SHA256SUMS']=checksum
    with tarfile.open(OUTPUT,'w:gz') as archive:
        for name,path in members.items():archive.add(path,arcname=name,recursive=False)
    OUTPUT.chmod(0o600)
    receipt=dict(archive=str(OUTPUT),archive_sha256=hashlib.sha256(OUTPUT.read_bytes()).hexdigest(),
                 encrypted_payload_sha256=manifest['encrypted_payload_sha256'],
                 credential_files=len(metadata),unlock_key_inside_archive=False,
                 crypto_round_trip_pass=True,raw_secrets_logged=False)
    (BASE/'BUILD-RESULT.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt))


if __name__=='__main__':build()
