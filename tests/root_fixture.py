import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import types

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
    installed=fixture/'code';installed.mkdir(mode=0o755);installed.chmod(0o755)
    pins={}
    for source_file in (ROOT/'legacy').glob('*.py'):
        dest=installed/source_file.name;dest.write_bytes(source_file.read_bytes());dest.chmod(0o644);pins[dest.name]=cp.digest(dest)
    child_code=(ROOT/'probe.py').read_text()+'\nprint(json.dumps(inspect(sys.argv[1],sys.argv[2])))\n'
    result=subprocess.run(['/usr/bin/python3','-I','-B','-c',child_code,str(target),str(installed)],user=uid,group=gid,extra_groups=[],capture_output=True,text=True,timeout=30)
    if result.returncode:raise RuntimeError('actual nonroot passive inspection failed: '+result.stderr[-1200:])
    script=target/'sources'/('b'*40)/'tree/run.sh'
    executable=subprocess.run([str(script)],user=uid,group=gid,extra_groups=[],env={'PATH':'/usr/bin:/bin'},capture_output=True,text=True,timeout=10)
    assert executable.returncode==0 and executable.stdout=='fictional only\n'
    assert cp.database_facts(target/'queue.sqlite')==meta['facts']
    spec=importlib.util.spec_from_file_location('crypto_fixture_operator',ROOT/'operator.py')
    op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)
    op.CODE=installed
    # Test fixture ancestors belong to the invoking user; production performs
    # its independent root-parent gate before these real file-owner/hash gates.
    op.assert_parents=lambda path:None
    payload={'role':'target','helper':(ROOT/'checkpoint.py').read_text(),'policy':{'helper_sha256':cp.digest(ROOT/'checkpoint.py'),'recovery_sha256':RECOVERY_SHA,'installed_probe_sha256':pins}}
    op.load_helper(payload)
    (installed/'coordinator.py').write_text('# unexpected change, never execute\n')
    try:op.load_helper(payload)
    except ValueError:pass
    else:raise AssertionError('altered installed probe module accepted')
    stage=short/'crypto';stage.mkdir(mode=0o700)
    unlock=b'fictional fixture encryption passphrase\n'
    gpg=short/'encrypt-gpg';gpg.mkdir(mode=0o700)
    cipher=stage/'checkpoint.tar.gpg'
    try:
        encrypted=subprocess.run(['gpg','--homedir',str(gpg),'--batch','--no-symkey-cache','--pinentry-mode','loopback','--passphrase-fd','0','--symmetric','--cipher-algo','AES256','--output',str(cipher),meta['snapshot']],input=unlock,capture_output=True,env={'PATH':'/usr/bin:/bin','TMPDIR':str(short)},timeout=60)
        if encrypted.returncode:raise RuntimeError('fixture encryption failed: '+encrypted.stderr.decode(errors='replace')[-1600:])
    finally:
        subprocess.run(['gpgconf','--homedir',str(gpg),'--kill','gpg-agent'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=15)
    op.TARGET_STAGE=stage
    stdin=sys.stdin
    try:
        sys.stdin=types.SimpleNamespace(buffer=io.BytesIO(unlock))
        crypto=op.decrypt({'cipher_sha256':cp.digest(cipher),'capture':meta})
    finally:sys.stdin=stdin
    assert crypto['decrypted_and_hash_verified'] and crypto['unlock_file_created'] is False
    assert not (stage/'unlock.key').exists()
    assert all(unlock.strip() not in p.read_bytes() for p in stage.rglob('*') if p.is_file())
    assert cp.digest(stage/'checkpoint.tar.gz')==meta['sha256']
    bad=short/'crypto-bad';bad.mkdir(mode=0o700)
    (bad/'checkpoint.tar.gpg').write_bytes(b'corrupt ciphertext');(bad/'checkpoint.tar.gpg').chmod(0o600)
    op.TARGET_STAGE=bad
    try:op.decrypt({'cipher_sha256':'0'*64,'capture':meta})
    except ValueError:pass
    else:raise AssertionError('invalid cipher accepted')
    assert not (bad/'unlock.key').exists()
    op.SOURCE=source;op.WORKER=worker
    op.SOURCE_STAGE=fixture/'missing-project-parent'/'attempt2'
    op.guard=lambda role:None
    op.load_helper=lambda req:(cp,recovery)
    op.source_preflight=lambda req,helper:{'bounded_fixture':True}
    captured=op.main({'role':'source','action':'capture','policy':{'baseline':{'facts':meta['facts']}}})
    assert captured['fixed_project_parent_created'] is True
    assert op.SOURCE_STAGE.parent.stat().st_uid==0 and op.SOURCE_STAGE.parent.stat().st_mode&0o777==0o700
    assert op.prepare_source_parent() is False
    foreign=fixture/'foreign-project-parent';foreign.mkdir(mode=0o755);foreign.chmod(0o755);os.chown(foreign,uid,gid)
    op.SOURCE_STAGE=foreign/'attempt2'
    try:op.prepare_source_parent()
    except PermissionError:pass
    else:raise AssertionError('foreign project parent adopted')
    assert foreign.stat().st_uid==uid and foreign.stat().st_mode&0o777==0o755
    linked=fixture/'linked-project-parent';linked.symlink_to(fixture/'missing-project-parent',target_is_directory=True);op.SOURCE_STAGE=linked/'attempt2'
    try:op.prepare_source_parent()
    except ValueError:pass
    else:raise AssertionError('linked project parent adopted')
    print(json.dumps({'actual_nonroot_probe':json.loads(result.stdout),'fictional_script_executable':True,'schema_rows_preserved':True,'real_accounts_changed':False,'real_root_decrypt_integrity_pass':True,'unlock_stdin_only_no_file_success_or_failure':True,'altered_probe_import_hash_refused':True,'missing_source_parent_created_root0700_and_capture_completed':True,'foreign_or_linked_source_parent_rejected':True}))


if __name__=='__main__':
    try:main()
    finally:
        if len(sys.argv)>1:
            fixture=Path(sys.argv[1])
            if not fixture.is_symlink() and fixture.parent.resolve()==(ROOT/'test-work').resolve():
                for name in ['source','worker','capture','restored','code','missing-project-parent','foreign-project-parent','linked-project-parent']:
                    p=fixture/name
                    if p.is_dir() and not p.is_symlink():shutil.rmtree(p)
                    elif p.is_symlink():p.unlink()
        if len(sys.argv)>4:
            short=Path(sys.argv[4])
            if not short.is_symlink() and short.parent.resolve()==Path('/mnt/apps/peticao-final/.gpt1').resolve():
                for name in ['crypto','crypto-bad','encrypt-gpg']:
                    p=short/name
                    if p.is_dir() and not p.is_symlink():shutil.rmtree(p)
