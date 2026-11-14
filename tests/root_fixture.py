import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]


def main():
    fixture=Path(sys.argv[1]);uid,gid=int(sys.argv[2]),int(sys.argv[3]);short=Path(sys.argv[4])
    if os.geteuid()!=0 or uid==0 or fixture.is_symlink() or fixture.parent.resolve()!=(ROOT/'test-work').resolve() or fixture.stat().st_uid!=uid:
        raise PermissionError('existing own bounded fixture with nonroot target required')
    if short.is_symlink() or short.parent.resolve()!=Path('/mnt/apps/peticao-final/.gpt1').resolve() or short.stat().st_uid!=uid:
        raise PermissionError('existing short project crypto fixture required')
    os.umask(0o077)
    sys.path.insert(0,str(ROOT));sys.path.insert(0,str(ROOT/'tests'))
    import checkpoint as cp
    from test_checkpoint import fixture as make_fixture, RECOVERY_SHA
    source,worker=make_fixture(fixture);recovery=cp.load_recovery(ROOT/'legacy/recovery.py',RECOVERY_SHA)
    meta=cp.capture(source,worker,fixture/'capture',recovery)
    target=fixture/'restored';cp.restore(meta['snapshot'],target,meta['sha256'],meta['facts'],recovery,uid,gid)
    child_code=(ROOT/'probe.py').read_text()+'\nprint(json.dumps(inspect(sys.argv[1],sys.argv[2])))\n'
    result=subprocess.run(['/usr/bin/python3','-I','-B','-c',child_code,str(target),str(ROOT/'legacy')],user=uid,group=gid,extra_groups=[],capture_output=True,text=True,timeout=30)
    if result.returncode:raise RuntimeError('actual nonroot passive inspection failed: '+result.stderr[-1200:])
    script=target/'sources'/('b'*40)/'tree/run.sh'
    executable=subprocess.run([str(script)],user=uid,group=gid,extra_groups=[],env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True,timeout=10)
    assert executable.returncode==0 and executable.stdout=='fictional only\n'
    assert cp.database_facts(target/'queue.sqlite')==meta['facts']
    spec=importlib.util.spec_from_file_location('crypto_fixture_operator',ROOT/'operator.py')
    op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)
    stage=short/'crypto';stage.mkdir(mode=0o700)
    key=stage/'unlock.key';key.write_text('fictional fixture encryption passphrase');key.chmod(0o600)
    gpg=short/'encrypt-gpg';gpg.mkdir(mode=0o700)
    cipher=stage/'checkpoint.tar.gpg'
    try:
        encrypted=subprocess.run(['gpg','--homedir',str(gpg),'--batch','--no-symkey-cache','--pinentry-mode','loopback','--passphrase-file',str(key),'--symmetric','--cipher-algo','AES256','--output',str(cipher),meta['snapshot']],capture_output=True,env={'PATH':'/usr/bin:/bin','TMPDIR':str(short)},timeout=60)
        if encrypted.returncode:raise RuntimeError('fixture encryption failed: '+encrypted.stderr.decode(errors='replace')[-1600:])
    finally:
        subprocess.run(['gpgconf','--homedir',str(gpg),'--kill','gpg-agent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
    op.TARGET_STAGE=stage
    crypto=op.decrypt({'cipher_sha256':cp.digest(cipher),'capture':meta})
    assert crypto['decrypted_and_hash_verified'] and not key.exists()
    assert cp.digest(stage/'checkpoint.tar.gz')==meta['sha256']
    bad=short/'crypto-bad';bad.mkdir(mode=0o700)
    key=bad/'unlock.key';key.write_text('fictional fixture passphrase');key.chmod(0o600)
    (bad/'checkpoint.tar.gpg').write_bytes(b'corrupt ciphertext');(bad/'checkpoint.tar.gpg').chmod(0o600)
    op.TARGET_STAGE=bad
    try:op.decrypt({'cipher_sha256':'0'*64,'capture':meta})
    except ValueError:pass
    else:raise AssertionError('invalid cipher accepted')
    assert not key.exists()
    print(json.dumps({'actual_nonroot_probe':json.loads(result.stdout),'fictional_script_executable':True,'schema_rows_preserved':True,'real_accounts_changed':False,'real_root_decrypt_integrity_pass':True,'temporary_unlock_deleted_success_and_failure':True}))


if __name__=='__main__':
    try:main()
    finally:
        if len(sys.argv)>1:
            fixture=Path(sys.argv[1])
            if not fixture.is_symlink() and fixture.parent.resolve()==(ROOT/'test-work').resolve():
                for name in ['source','worker','capture','restored']:
                    p=fixture/name
                    if p.is_dir() and not p.is_symlink():shutil.rmtree(p)
        if len(sys.argv)>4:
            short=Path(sys.argv[4])
            if not short.is_symlink() and short.parent.resolve()==Path('/mnt/apps/peticao-final/.gpt1').resolve():
                for name in ['crypto','crypto-bad','encrypt-gpg']:
                    p=short/name
                    if p.is_dir() and not p.is_symlink():shutil.rmtree(p)
