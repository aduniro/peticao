"""Node admission barrier: shared by RPC mutations, exclusive for fencing.

Not a distributed lock/election. Fencing must close every node and prove all
old helpers drained before stopping units or changing the persistent epoch.
"""
import contextlib
import fcntl
import json
import os
from pathlib import Path
import uuid
import artifacts

import remote_contract as contract


class Admission:
    def __init__(self,root,validator=contract.root_control_file):
        self.root=Path(root);self.validator=validator

    @contextlib.contextmanager
    def lock(self,exclusive=False):
        path=self.validator(self.root/'admission.lock')
        fd=os.open(path,os.O_RDONLY|os.O_NOFOLLOW)
        try:
            try:fcntl.flock(fd,(fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH)|fcntl.LOCK_NB)
            except BlockingIOError:raise RuntimeError('worker_admission_busy_observe_only') from None
            yield
        finally:
            os.close(fd)

    @contextlib.contextmanager
    def mutation(self,manifest):
        with self.lock():
            data=json.loads(self.validator(self.root/'admission.json').read_text())
            if not isinstance(data,dict) or set(data)!={'enabled','epoch_sha256'} or data['enabled'] is not True or data['epoch_sha256']!=manifest['epoch_sha256']:
                raise PermissionError('worker_admission_closed_or_epoch_changed')
            yield

    @contextlib.contextmanager
    def fencing_barrier(self):
        # Operator-only API. It does not stop units, change epoch or silently
        # reopen admission. Caller must atomically persist enabled=false while
        # holding this barrier, then keep it through its fresh stop proof.
        with self.lock(exclusive=True):yield

    @contextlib.contextmanager
    def closed_for_fencing(self):
        with self.lock(exclusive=True):
            path=self.validator(self.root/'admission.json')
            data=json.loads(path.read_text())
            if not isinstance(data,dict) or set(data)!={'enabled','epoch_sha256'}:raise ValueError('exact_admission_metadata_required')
            contract.hex_value(data['epoch_sha256'],64)
            temp=self.root/('.admission-closed-'+uuid.uuid4().hex)
            artifacts.durable_json(temp,{'enabled':False,'epoch_sha256':data['epoch_sha256']})
            os.replace(temp,path);artifacts.sync_dir(self.root)
            # Remains closed after the context exits, including on exceptions.
            yield {'enabled':False,'epoch_sha256':data['epoch_sha256']}
