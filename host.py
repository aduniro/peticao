"""Fixed root Civo operator. No actions on import. Separate reviewed execution.

No start/stop, schema creation, wildcard, artifact export, cleanup replay or
generic command. Old helper is imported ONLY after independent frozen pins.
"""
import contextlib
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import stat
import sys

sys.dont_write_bytecode = True
PUBLIC = Path('/opt/peticao-attempt2-reconcile-20261115')
OLD = Path('/opt/peticao-dev-worker-qual-20261114-attempt2')
PRIVATE = Path('/mnt/apps/peticao-final/.runtime/civo-worker-runtime-qual-20261114-attempt2')


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def sha(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def trusted(path, directory=False, mode=None):
    path = Path(path)
    for item in [*reversed(path.parents), path]:
        info = item.lstat()
        if stat.S_ISLNK(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise PermissionError('trusted_root_chain_required')
    info = path.lstat()
    if ((directory and not stat.S_ISDIR(info.st_mode)) or (not directory and (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1)) or (mode is not None and stat.S_IMODE(info.st_mode) != mode)):
        raise PermissionError('exact_trusted_type_mode_required')
    return path


def read(path):
    p = trusted(path)
    fd = os.open(p, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as f:
        raw = f.read(2 * 1024 * 1024 + 1)
    if len(raw) > 2 * 1024 * 1024:
        raise ValueError('bounded_private_metadata_required')
    return json.loads(raw)


def import_exact(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


def load(expected):
    if os.geteuid() != 0 or socket.gethostname().split('.')[0] != 'peticao-civo' or Path(__file__).absolute() != PUBLIC / 'host.py':
        raise PermissionError('fixed_civo_installed_root_operator_required')
    trusted(PUBLIC, True, 0o755)
    request = read(PUBLIC / 'RUN-RECONCILE.json')
    if sha(request) != expected or type(request) is not dict or set(request) != {'authorization', 'execute', 'code_sha256'} or request['execute'] is not True:
        raise PermissionError('reviewed_exact_reconciliation_required')
    names = {'host.py', 'reconcile.py', 'SOURCE-PINS.json'}
    if set(request['code_sha256']) != names or set(p.name for p in PUBLIC.iterdir()) != names | {'RUN-RECONCILE.json'}:
        raise PermissionError('fixed_public_members_required')
    for name, digest in request['code_sha256'].items():
        if hashlib.sha256(trusted(PUBLIC / name, mode=0o644).read_bytes()).hexdigest() != digest:
            raise PermissionError('own_frozen_code_changed')
    pins = read(PUBLIC / 'SOURCE-PINS.json')
    if pins['old_public'] != str(OLD) or pins['old_private'] != str(PRIVATE) or pins['original_execution_event'] != 3151:
        raise PermissionError('original_scope_changed')
    trusted(OLD, True, 0o755); trusted(PRIVATE, True, 0o700)
    original = read(OLD / 'RUN-REQUEST.json')
    if sha(original) != pins['original_request_sha256'] or original['operation_id'] != pins['original_operation_id']:
        raise PermissionError('old_request_changed')
    for name, digest in pins['members'].items():
        if '/' in name or hashlib.sha256(trusted(OLD / name, mode=0o644).read_bytes()).hexdigest() != digest:
            raise PermissionError('old_frozen_member_changed')
    core = import_exact('attempt2_reconcile_core', PUBLIC / 'reconcile.py')
    core.authorization(request['authorization'])
    helper = import_exact('attempt2_old_helper', OLD / 'qualification_helper.py')
    old_request, modules = helper.load()
    if sha(old_request) != pins['original_request_sha256'] or helper.boot_id() != core.PRODUCTION.boot:
        raise PermissionError('old_boot_or_request_changed')
    return request, core, helper, modules


class HostPort:
    def __init__(self, request, core, helper, modules):
        self.request, self.core, self.h, self.m = request, core, helper, modules
        self.p = core.PRODUCTION
        self.admission = modules['admission'].Admission(PRIVATE / 'journal')
        self.storage = modules['project_storage'].ProjectStorage(PRIVATE / 'job-backing')
        self.evidence = PRIVATE / ('reconciliation-' + request['authorization']['operation_id'])
        self.locked = False

    def authorize(self):
        # Same fixed grant whose digest the locally gated SSH phase supplied.
        # Phase duration is bounded below the Gate's own-lease safety margin.
        return self.request['authorization']

    @contextlib.contextmanager
    def exclusive_closed(self):
        with self.h.execution_lock():
            # Exclusive fresh entry intent before even closing admission.
            # A partial directory is uncertain, NEVER reused by another call.
            self.evidence.mkdir(mode=0o700)
            self.m['artifacts'].sync_dir(PRIVATE)
            self.m['artifacts'].durable_json(self.evidence / 'entry-intent.json', self.authorize())
            with self.admission.closed_for_fencing():
                self.locked = True
                try:
                    yield self.lock_receipt()
                finally:
                    self.locked = False

    def lock_receipt(self):
        if not self.locked:
            raise PermissionError('both_locks_required')
        value = read(PRIVATE / 'journal/admission.json')
        return {'execution_exclusive': True, 'admission_exclusive': True,
                'enabled': value['enabled'], 'epoch_sha256': value['epoch_sha256']}

    def history(self):
        # Never build the old worker, initialize schema or open an operational DB.
        path = trusted(PRIVATE / 'journal/receipts.sqlite', mode=0o600)
        with contextlib.closing(sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=5)) as db:
            db.row_factory = sqlite3.Row
            db.execute('PRAGMA query_only=ON'); db.execute('BEGIN')
            row = db.execute('SELECT manifest_json,receipt_json FROM receipts WHERE job_id=?', (self.p.job,)).fetchone()
            bound = db.execute('SELECT receipt_sha256,invocation_id,cgroup_path,stop_proof,bundle_sha256 FROM unit_bindings WHERE job_id=?', (self.p.job,)).fetchone()
            if row is None or bound is None:
                raise PermissionError('original_durable_records_required')
            manifest, receipt = json.loads(row['manifest_json']), json.loads(row['receipt_json'])
            binding = dict(bound); binding['stop_proof'] = json.loads(binding['stop_proof'])
        runners = {name: read(PRIVATE / name) for name in ('run-intent.json', 'runner-receipt.json')}
        return manifest, receipt, binding, runners

    def snapshot(self):
        manifest, receipt, binding, runners = self.history()
        historical = self.core.history(manifest, receipt, binding, runners, self.p)
        proc = Path('/proc/' + str(self.p.runner_pid))
        # Refuse PID reuse as well as the original live runner. No process kill.
        runner_state = 'present' if proc.exists() else 'absent'
        state = self.m['systemd_adapter'].SystemdAdapter().properties(self.p.unit)
        unit = {k: state[k] for k in ('LoadState', 'ActiveState', 'SubState', 'ControlGroup', 'InvocationID')}
        unit.update(name=self.p.unit, MainPID=int(state['MainPID']))
        raw_mounts = Path('/proc/self/mountinfo').read_text()
        roots = [line for line in raw_mounts.splitlines() if line.split()[4] == '/sys/fs/cgroup']
        if len(roots) != 1 or roots[0].split(' - ', 1)[1].split()[0] != 'cgroup2':
            raise PermissionError('actual_cgroup2_mount_required')
        cg = self.m['cgroups'].snapshot(self.p.cgroup)
        cg.update(path=self.p.cgroup, v2_mount_verified=True)
        proof = self.storage.verify(manifest, receipt)
        record = self.storage._record(manifest, receipt)
        mount = {k: proof[k] for k in ('mount_id', 'device', 'inode', 'source', 'target')}
        mount.update(underlay_device=record['underlay_device'], underlay_inode=record['underlay_inode'], single=True, nested=False, rw=True)
        paths = {}
        for key, path in (('parent', self.p.parent), ('source', self.p.source), ('target', self.p.target)):
            if key == 'parent':
                trusted(Path(path), True, 0o700)
            else:
                trusted(Path(path).parent, True, 0o700)
            info = Path(path).lstat()
            if not stat.S_ISDIR(info.st_mode):
                raise PermissionError('real_directory_without_link_required')
            paths[key] = {'path': path, 'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid, 'gid': info.st_gid, 'mode': stat.S_IMODE(info.st_mode), 'no_symlink_chain': True}
        alias = Path(self.p.public); ai = alias.lstat()
        if not stat.S_ISLNK(ai.st_mode) or os.readlink(alias) not in {self.p.target, 'private/' + self.p.name}:
            raise PermissionError('exact_old_alias_required')
        paths['alias'] = {'path': self.p.public, 'uid': ai.st_uid, 'symlink': True, 'target': self.p.target}
        a, b = os.stat('/proc/self/ns/mnt'), os.stat('/proc/1/ns/mnt')
        same = (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino)
        for local, manager in (('/', '/proc/1/root'), ('/tmp', '/proc/1/root/tmp'), ('/var/tmp', '/proc/1/root/var/tmp')):
            a, b = os.stat(local), os.stat(manager)
            same &= (a.st_dev, a.st_ino) == (b.st_dev, b.st_ino)
        return {'boot_id': self.h.boot_id(), 'manager_view_verified': same,
                'runner_identity': historical['runner_identity'], 'runner_state': runner_state,
                'unit': unit, 'cgroup': cg, 'mount': mount, 'paths': paths, 'storage_state': record['state'],
                'durable_records_sha256': {k: historical[k] for k in ('manifest_sha256', 'receipt_sha256', 'binding_sha256', 'runners_sha256')}}

    def new_intent(self, value):
        self.m['artifacts'].durable_json(self.evidence / 'storage-intent.json', value)

    def cleanup(self, manifest, receipt, stopped):
        if not self.locked:
            raise PermissionError('reconciliation_without_locks_refused')
        self.storage.cleanup(manifest, receipt, stopped)

    def final_readback(self):
        manifest, receipt, _, _ = self.history()
        state = self.storage.status(manifest, receipt)
        source = Path(self.p.source); info = source.lstat()
        parent = trusted(Path(self.p.parent), True, 0o700)
        return {**state, 'device': info.st_dev, 'inode': info.st_ino, 'uid': info.st_uid,
                'mode': stat.S_IMODE(info.st_mode), 'target_absent': not os.path.lexists(self.p.target),
                'alias_absent': not os.path.lexists(self.p.public), 'root_private_parent_preserved': parent.stat().st_ino == self.p.parent_inode}

    def new_receipt(self, value):
        self.m['artifacts'].durable_json(self.evidence / 'retained-receipt.json', value)


def main():
    if len(sys.argv) != 3 or sys.argv[1] not in {'preflight', 'cleanup'}:
        raise ValueError('fixed_reconciliation_phase_required')
    signal.signal(signal.SIGALRM, lambda *_: (_ for _ in ()).throw(TimeoutError('bounded_reconciliation')))
    signal.alarm(60)
    request, core, helper, modules = load(sys.argv[2])
    port = HostPort(request, core, helper, modules)
    if sys.argv[1] == 'preflight':
        with helper.execution_lock():
            manifest, receipt, binding, runners = port.history()
            historical = core.history(manifest, receipt, binding, runners, core.PRODUCTION)
            core.fresh(port.snapshot(), historical, core.PRODUCTION)
        print(json.dumps({'state': 'EXACT_ATTEMPT2_PREFLIGHT_VERIFIED', 'mount_count': 1, 'qualification_pass': False}))
    else:
        result = core.reconcile(port)
        print(json.dumps({'state': result['state'], 'mount_count': 0, 'qualification_pass': False}))


if __name__ == '__main__':
    try:
        main()
    except BaseException:
        # Live paths, SQLite data and exception text never enter tool context.
        print(json.dumps({'state': 'RECONCILIATION_UNCERTAIN_PRESERVE_NO_REPLAY', 'qualification_pass': False}))
        sys.exit(1)
