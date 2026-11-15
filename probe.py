"""Read restored state as service user; never initialize, promote or run a job."""
import hashlib
import json
import os
from pathlib import Path
import sys


def inspect(root, code):
    root,code=Path(root),Path(code)
    if os.geteuid()==0:
        raise PermissionError('actual nonroot service identity required')
    os.environ.update(ADMIN_CLUSTER_ROOT=str(root),ADMIN_WORKER_ROOT=str(root/'recovered-worker'),ADMIN_CLUSTER_DISPATCH='0',ADMIN_CLUSTER_KUBERNETES='0',PYTHONDONTWRITEBYTECODE='1')
    sys.path.insert(0,str(code))
    import coordinator
    import standby_guard
    if coordinator.ROOT!=root:
        raise ValueError('wrong coordinator import root')
    before=hashlib.sha256((root/'queue.sqlite').read_bytes()).hexdigest()
    result=standby_guard.validate(root)
    rejected=[]
    for name,call in [('primary',coordinator.primary),('dispatch',coordinator.dispatch_once),('submit',lambda:coordinator.rpc({'action':'submit'})),('cancel',lambda:coordinator.rpc({'action':'cancel'})),('import-source',lambda:coordinator.rpc({'action':'import-source'}))]:
        try:call()
        except PermissionError:rejected.append(name)
        else:raise AssertionError('standby allowed primary operation')
    files=0
    for path in root.rglob('*'):
        if path.is_symlink():raise ValueError('linked standby object')
        if path.is_dir():
            if path.stat().st_mode&0o777!=0o700:raise ValueError('private directory permissions required')
        elif path.is_file():
            if path.stat().st_uid!=os.geteuid() or path.stat().st_mode&0o777 not in {0o600,0o700}:
                raise ValueError('private owned restored file required')
            with path.open('rb') as stream:hashlib.file_digest(stream,'sha256')
            files+=1
        else:raise ValueError('special standby object')
    if hashlib.sha256((root/'queue.sqlite').read_bytes()).hexdigest()!=before:
        raise AssertionError('read-only probes changed queue')
    return {**result,'uid':os.geteuid(),'all_restored_files_readable':files,'primary_operations_rejected':rejected,'queue_file_unchanged':True,'services_started':False,'jobs_executed':False}
