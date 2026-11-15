"""Scoped Santiago legacy fencing; no promotion, floor write or job replay.

This root entry is inert until a reviewed code/policy packet is installed. The
controller must validate its own canonical lease immediately before SSH. Root
policy/OS/stdlib are TCB; this is not defense against a malicious administrator.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import stat
import subprocess
import sys
import time

LIB = Path('/opt/peticao-dev-bootstrap-v1')
POLICY = Path('/etc/peticao-dev-authority/source-fence.json')
STATE = Path('/mnt/apps/peticao-final/.runtime/peticao-dev-migration')
FILES = ('legacy_fence.py', 'service_metadata.py', 'operator_journal.py', 'legacy_cgroups.py', 'unit_refs.py')
UNIT = 'admin-v2-coordinator.service'
JOB = re.compile(r'admin-v2-job-[a-fA-F0-9-]{32,36}\.service\Z')
UNIT_FIELDS = {'LoadState', 'ActiveState', 'SubState', 'MainPID', 'ControlGroup', 'InvocationID'}
INVENTORY = ['list-units', '--all', '--plain', '--no-legend', '--no-pager', 'admin-v2-job-*.service']
SCOPE = 'santiago_legacy_dispatcher_and_bound_job_units_only'


def valid_unit(unit):
    if unit != UNIT and (type(unit) is not str or not JOB.fullmatch(unit)):
        raise PermissionError('fixed_legacy_development_unit_required')
    return unit


def boot():
    return Path('/proc/sys/kernel/random/boot_id').read_text().strip()


def operator_identity():
    fields = Path('/proc/self/stat').read_text().rsplit(')', 1)[1].split()
    start = int(fields[19])
    if start < 1:
        raise PermissionError('operator_process_start_identity_required')
    return {'pid': os.getpid(), 'start_ticks': start, 'boot_id': boot()}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate_operator_json_key')
        value[key] = item
    return value


def manager_namespace():
    def identity(path):
        info = os.stat(path)
        return info.st_dev, info.st_ino
    if identity('/proc/self/ns/mnt') != identity('/proc/1/ns/mnt'):
        raise PermissionError('source_operator_pid1_mount_namespace_required')
    for name in ('/', '/srv/admin-v2-coordinator', '/etc/peticao-dev-authority'):
        if identity(name) != identity('/proc/1/root' + name):
            raise PermissionError('source_operator_pid1_filesystem_view_required')


def read_root(path, mode, limit=1024**2):
    path = Path(path)
    for parent in path.parents:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022:
            raise PermissionError('root_controlled_operator_ancestry_required')
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(fd, 'rb') as stream:
        before = os.fstat(stream.fileno())
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1
                or stat.S_IMODE(before.st_mode) != mode or before.st_size > limit):
            raise PermissionError('root_regular_operator_packet_required')
        raw = stream.read(limit + 1)
        after = os.fstat(stream.fileno())
    fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_uid', 'st_gid', 'st_mode', 'st_nlink')
    if len(raw) > limit or len(raw) != before.st_size or any(getattr(before, k) != getattr(after, k) for k in fields):
        raise PermissionError('operator_packet_changed')
    return raw


def gate(request):
    if os.geteuid() != 0 or socket.gethostname() != 'sonda-verifica3' or Path(__file__).absolute() != LIB / 'legacy_fence.py':
        raise PermissionError('exact_installed_root_source_entry_required')
    if type(request) is not dict or set(request) != {'action', 'operation_id', 'policy_sha256'} or request['action'] not in {'fence', 'observe'}:
        raise PermissionError('fixed_operator_request_required')
    raw = read_root(POLICY, 0o600)
    policy = json.loads(raw, object_pairs_hook=unique)
    keys = {'status', 'operation_id', 'source_boot_id', 'authority_sha256',
            'manifest_event', 'peer_ack_event', 'code_sha256'}
    if (type(policy) is not dict or set(policy) != keys or policy['status'] != 'REVIEWED_SOURCE_FENCE'
            or not re.fullmatch('[a-f0-9]{32}', policy['operation_id'])
            or not re.fullmatch('[a-f0-9]{64}', policy['authority_sha256'])
            or policy['source_boot_id'] != boot() or request['operation_id'] != policy['operation_id']
            or request['policy_sha256'] != hashlib.sha256(raw).hexdigest()
            or any(type(policy[key]) is not int or policy[key] < 1 for key in ('manifest_event', 'peer_ack_event'))
            or type(policy['code_sha256']) is not dict or set(policy['code_sha256']) != set(FILES)):
        raise PermissionError('reviewed_current_boot_source_fence_policy_required')
    for name in FILES:
        if hashlib.sha256(read_root(LIB / name, 0o644)).hexdigest() != policy['code_sha256'][name]:
            raise PermissionError('operator_code_pin_mismatch_before_import')
    manager_namespace()
    return policy


class Manager:
    def command(self, args):
        if not args or args[0] not in {'show', 'list-units', 'stop'}:
            raise PermissionError('fixed_legacy_systemd_operations_required')
        if args[0] == 'stop':
            if len(args) != 2:
                raise PermissionError('one_bound_unit_stop_required')
            valid_unit(args[1])
        elif args[0] == 'list-units':
            if args != INVENTORY:
                raise PermissionError('fixed_legacy_job_inventory_only')
        elif (len(args) != 4 or args[2:] != ['--no-pager', '--property=' + ','.join(sorted(UNIT_FIELDS))]):
            raise PermissionError('fixed_unit_fields_only')
        else:
            valid_unit(args[1])
        process = subprocess.run(['/usr/bin/systemctl', *args], capture_output=True,
                                 text=True, timeout=120,
                                 env={'PATH': '/usr/bin:/bin', 'LANG': 'C.UTF-8'})
        if process.returncode or len(process.stdout) > 131072:
            raise RuntimeError('systemd_operation_uncertain_no_replay')
        return process.stdout

    def inventory(self):
        rows = self.command(INVENTORY)
        names = []
        for row in rows.splitlines():
            name = row.split()[0]
            if not JOB.fullmatch(name) or name in names:
                raise PermissionError('exact_legacy_inventory_required')
            names.append(name)
        if len(names) > 128:
            raise PermissionError('legacy_inventory_budget')
        return sorted(names)

    def state(self, unit):
        valid_unit(unit)
        fields = UNIT_FIELDS
        raw = self.command(['show', unit, '--no-pager', '--property=' + ','.join(sorted(fields))])
        result = {}
        for line in raw.splitlines():
            key, sep, value = line.partition('=')
            if not sep or key in result or key not in fields:
                raise PermissionError('complete_unique_unit_fields_required')
            result[key] = value
        if set(result) != fields or not result['MainPID'].isdigit():
            raise PermissionError('complete_typed_unit_fields_required')
        expected = '/system.slice/' + unit
        if result['ControlGroup'] not in {'', expected}:
            raise PermissionError('fixed_bound_legacy_cgroup_required')
        return {**result, 'MainPID': int(result['MainPID']), 'bound_cgroup': expected}

    def cgroup(self, unit):
        valid_unit(unit)
        import legacy_cgroups
        return legacy_cgroups.snapshot('/system.slice/' + unit)

    def stop(self, unit):
        valid_unit(unit)
        self.command(['stop', unit])


def references():
    from unit_refs import UnitReferences
    class LegacyReferences(UnitReferences):
        def _identity(self, unit, invocation):
            valid_unit(unit)
            if type(invocation) is not str or not re.fullmatch('[a-f0-9]{32}', invocation):
                raise PermissionError('legacy_bound_invocation_required')
    return LegacyReferences()


class Fence:
    def __init__(self, authority, manager, refs, journal, operation, boot_reader=boot):
        self.authority, self.manager, self.refs, self.journal = authority, manager, refs, journal
        self.operation, self.boot_reader = operation, boot_reader

    def budget(self):
        if time.monotonic() > self.deadline:
            raise TimeoutError('source_fence_budget_exhausted_no_replay')

    def stable_authority(self, expected_sha):
        current = self.authority.read()
        if current is None or current.sha256 != expected_sha or self.boot_reader() != self.operation['source_boot_id']:
            raise PermissionError('source_authority_or_boot_changed')
        return current

    def stopped(self, unit, binding, reference=True):
        state = self.manager.state(unit)
        if reference:
            self.refs.assert_held(unit, binding['InvocationID'])
        if (state['LoadState'] != 'loaded' or state['ActiveState'] not in {'inactive', 'failed'}
                or state['MainPID'] != 0 or state['InvocationID'] != binding['InvocationID']):
            raise PermissionError('same_bound_legacy_unit_not_stopped')
        group = self.manager.cgroup(unit)
        if group.get('empty') is not True or group.get('pids_count') != 0:
            raise PermissionError('bound_legacy_cgroup_not_empty')
        return {'unit': unit, 'invocation_id': binding['InvocationID'],
                'bound_cgroup': binding['bound_cgroup'], 'main_pid': 0,
                'cgroup_empty': True, 'cgroup_observation': group, 'unit_stopped': True}

    def run(self):
        self.deadline = time.monotonic() + 300
        previous = self.stable_authority(self.operation['authority_sha256'])
        value = json.loads(previous.raw, object_pairs_hook=unique)
        if (type(value.get('generation')) is not int or value['generation'] != 1
                or value.get('role') != 'primary' or value.get('armed_boot_id') != self.operation['source_boot_id']):
            raise PermissionError('fresh_legacy_primary1_preimage_required')
        names = [UNIT, *self.manager.inventory()]
        bindings = {}
        for name in names:
            self.budget()
            bindings[name] = self.manager.state(name)
        for name, state in bindings.items():
            if state['LoadState'] != 'loaded' or not re.fullmatch('[a-f0-9]{32}', state['InvocationID']):
                raise PermissionError('loaded_bound_legacy_invocation_required')
        operation_id = self.operation['operation_id']
        # Exclusive intent before references, metadata publication or stops.
        operator = operator_identity()
        self.journal.record('fence-intent.json', {'operation_id': operation_id,
            'source_boot_id': self.operation['source_boot_id'],
            'authority_preimage_sha256': previous.sha256, 'units': bindings,
            'operator_identity': operator, 'scope': SCOPE})
        for name in names:
            self.budget()
            self.refs.acquire(name, bindings[name]['InvocationID'])
        self.stable_authority(previous.sha256)
        self.budget()
        # Suspend before stopping dispatcher. Preserve exact source owner/mode,
        # do not transplant Civo's private service ownership onto Santiago.
        suspended = self.authority.publish({**value, 'role': 'suspended', 'armed_boot_id': None}, previous)
        for name in names:
            self.budget()
            self.refs.assert_held(name, bindings[name]['InvocationID'])
            current = self.manager.state(name)
            if current['InvocationID'] != bindings[name]['InvocationID']:
                raise PermissionError('legacy_invocation_recreated_before_stop')
            self.manager.stop(name)  # Each bound unit once; no timeout retries.
        current_jobs = self.manager.inventory()
        if set(current_jobs) != set(names) - {UNIT}:
            raise PermissionError('legacy_inventory_changed_during_fencing')
        proofs = []
        for name in names:
            self.budget()
            proofs.append(self.stopped(name, bindings[name]))
        self.budget()
        self.stable_authority(suspended.sha256)
        held = {'operation_id': operation_id, 'state': 'fenced_refs_held',
                'source_boot_id': self.operation['source_boot_id'], 'generation': 1,
                'authority_sha256': suspended.sha256, 'units': proofs,
                'reference_backend': self.refs.bus.backend_kind,
                'operator_identity': operator, 'scope': SCOPE}
        held_sha = self.journal.record('fenced-held.json', held)
        released = []
        for name in reversed(names):
            self.budget()
            released.append(self.refs.release(name, bindings[name]['InvocationID']))
        self.stable_authority(suspended.sha256)
        # Observe original bound cgroup paths after release too; an empty
        # manager ControlGroup must never erase the kernel-level binding.
        for name in names:
            group = self.manager.cgroup(name)
            if group.get('empty') is not True or group.get('pids_count') != 0:
                raise PermissionError('legacy_cgroup_changed_after_unref')
        terminal = {**held, 'state': 'fenced_refs_released', 'held_receipt_sha256': held_sha,
                    'released_references': released, 'all_releases_confirmed': True}
        terminal_sha = self.journal.record('fenced-released.json', terminal)
        current = self.observe()
        return {**current, 'services_started': False, 'epoch_written': False, 'queue_promoted': False,
                'scope': SCOPE, 'global_fencing_qualified': False}

    def observe(self):
        released = self.journal.read('fenced-released.json')
        if released is None:
            state = 'uncertain' if self.journal.read('fence-intent.json') else 'absent'
            return {'state': state, 'operation_id': self.operation['operation_id'], 'readonly': True}
        value, sha = released
        held = self.journal.read('fenced-held.json')
        if (held is None or value.get('held_receipt_sha256') != held[1]
                or value.get('all_releases_confirmed') is not True
                or value.get('source_boot_id') != self.boot_reader()):
            raise PermissionError('complete_same_boot_fence_receipts_required')
        self.stable_authority(value['authority_sha256'])
        expected = set()
        for proof in value['units']:
            unit = valid_unit(proof['unit'])
            expected.add(unit)
            current = self.manager.state(unit)
            if current['LoadState'] == 'not-found':
                if unit == UNIT:
                    raise PermissionError('persistent_coordinator_unit_missing')
            elif (current['LoadState'] != 'loaded' or current['MainPID'] != 0
                    or current['ActiveState'] not in {'inactive', 'failed'}
                    or current['InvocationID'] != proof['invocation_id']):
                raise PermissionError('fenced_legacy_unit_recreated_or_running')
            group = self.manager.cgroup(unit)
            if group.get('empty') is not True or group.get('pids_count') != 0:
                raise PermissionError('fenced_legacy_cgroup_not_empty')
        if UNIT not in expected or set(self.manager.inventory()) - (expected - {UNIT}):
            raise PermissionError('new_legacy_job_after_fence')
        self.stable_authority(value['authority_sha256'])
        return {'state': 'fenced', 'operation_id': self.operation['operation_id'],
                'receipt_sha256': sha, 'readonly': True}


def main(request):
    policy = gate(request)  # No own runtime/native imports before code pins.
    sys.path.insert(0, str(LIB))
    sys.dont_write_bytecode = True
    from service_metadata import Metadata, SANTIAGO
    from operator_journal import Journal
    authority = Metadata('/srv/admin-v2-coordinator/authority.json', SANTIAGO)
    journal = Journal(STATE / policy['operation_id'], policy['operation_id'])
    operation = {key: policy[key] for key in ('operation_id', 'source_boot_id', 'authority_sha256')}
    if request['action'] == 'observe':
        return Fence(authority, Manager(), None, journal, operation).observe()
    refs = references()
    try:
        if refs.bus.backend_kind != 'libsystemd-sd-bus':
            raise PermissionError('native_source_fencing_backend_required')
        return Fence(authority, Manager(), refs, journal, operation).run()
    finally:
        refs.close()


if __name__ == '__main__':
    try:
        raw = sys.stdin.buffer.read(65537)
        if len(raw) > 65536:
            raise ValueError('operator_request_budget')
        print(canonical(main(json.loads(raw, object_pairs_hook=unique))))
    except BaseException as error:
        print(canonical({'state': 'uncertain_or_rejected', 'error_type': type(error).__name__}))
        raise SystemExit(1)
