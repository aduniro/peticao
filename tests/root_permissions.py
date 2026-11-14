"""Root fixture only: exercise actual mkdir/chmod/chown and dropped-UID imports."""
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parents[1]


def main():
    uid,gid=int(sys.argv[2]),int(sys.argv[3])
    fixture=Path(sys.argv[1])
    if os.geteuid()!=0 or uid==0 or fixture.is_symlink() or fixture.parent.resolve()!=(ROOT/'test-work').resolve() or fixture.stat().st_uid!=uid:
        raise PermissionError('existing own project fixture and actual nonroot UID required')
    os.umask(0o077)
    control=fixture/'control';control.mkdir(mode=0o755)
    (control/'probe').write_text('public fixture')
    before=subprocess.run(['/usr/bin/python3','-I','-B','-c','import sys;open(sys.argv[1]).read()',str(control/'probe')],user=uid,group=gid,extra_groups=[],capture_output=True,text=True)
    assert control.stat().st_mode & 0o777==0o700 and before.returncode!=0
    spec=importlib.util.spec_from_file_location('civo_stage_permission_operator',ROOT/'operator.py')
    op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)
    for key,name in [('CODE','code'),('QUEUE','queue'),('UNIT','unit.service'),('STATE','state')]:setattr(op,key,fixture/name)
    person={'uid':uid,'gid':gid,'shell':'/usr/sbin/nologin','home':'/nonexistent'}
    created=False
    def identity():return person if created else None
    def run(argv,**kwargs):
        nonlocal created
        if argv[0]=='useradd':
            created=True
            return subprocess.CompletedProcess(argv,0,'','')
        if argv[0]=='runuser':
            actual=argv[argv.index('--')+1:]
            return subprocess.run(actual,user=uid,group=gid,extra_groups=[],capture_output=True,text=True,timeout=30)
        raise AssertionError('unexpected host command')
    op.identity=identity;op.run=run
    op.unit_state=lambda:{'LoadState':'not-found','ActiveState':'inactive'}
    op.preflight=lambda packet:op.decode(packet) and {'fixture_only':True}
    files={p.name:p.read_bytes() for p in (ROOT/'runtime').glob('*.py')};unit=(ROOT/'standby.service').read_bytes()
    packet={'commit':'a'*40,'runtime':{k:base64.b64encode(v).decode() for k,v in files.items()},'unit':base64.b64encode(unit).decode(),'hashes':{**{k:hashlib.sha256(v).hexdigest() for k,v in files.items()},'standby.service':hashlib.sha256(unit).hexdigest()}}
    result=op.apply(packet,{'lease':'fictional-permission-test','fence':1})
    assert result['nonroot_imports_verified'] and op.CODE.stat().st_mode&0o777==0o755
    assert op.CODE.stat().st_uid==0 and not op.QUEUE.exists()
    print(json.dumps({'umask077_control_mode700_denied_actual_nonroot':True,'fixed_code_mode755_root_owned':True,'actual_nonroot_imports_pass':True,'queue_created':False,'host_account_created':False}))


if __name__=='__main__':
    try:main()
    finally:
        if len(sys.argv)>1:
            fixture=Path(sys.argv[1])
            if fixture.parent.resolve()==(ROOT/'test-work').resolve() and not fixture.is_symlink():
                for name in ['control','code','queue','state','unit.service']:
                    p=fixture/name
                    if p.is_dir() and not p.is_symlink():shutil.rmtree(p)
                    elif p.exists() or p.is_symlink():p.unlink()
