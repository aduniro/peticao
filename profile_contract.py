"""Root-only real profile descriptor contract; no qualification by presence.

The existing manifest seals the entire descriptor in profile_sha256. Requests
cannot supply resources, commands, environments or artifact policies. Native
current-boot profile evidence is checked separately before service creation.
"""
import json
import os
from pathlib import Path
import stat

import remote_contract as contract

FIXTURES = frozenset({'fixture-pass', 'fixture-fail'})
REAL = frozenset({'admin-typecheck-v1', 'admin-build-v1', 'admin-qa-v1'})
NAMES = FIXTURES | REAL
BASE_KEYS = {'name', 'program', 'program_sha256', 'python_path', 'python_sha256',
             'source_sha256', 'dependencies_sha256', 'artifact_policy_sha256'}
KEYS = BASE_KEYS | {'version', 'plan_sha256', 'resources', 'artifact_policy'}
PROGRAM = '/opt/peticao-dev-profile-tools-v1/driver.py'
PYTHON = '/opt/peticao-dev-profile-tools-v1/python312/bin/python3.12'
GIB = 1024 ** 3
POLICY = {
    'version': 1, 'root': 'artifacts', 'root_relative_to': 'trusted_job_state_directory',
    'allowlist': ['profile-result.json', 'integrity-proof.json', 'phase-results.json',
                  'sanitized-build.log', 'sanitized-qa-summary.json',
                  'process-drain-proof.json', 'network-denial-summary.json'],
    'forbidden': ['credentials', 'dotfiles', 'mail', 'whatsapp', 'cron',
                  'production_data', 'database_state', 'signer_exports', 'raw_browser_storage'],
    'max_file_bytes': 16 * 1024 ** 2, 'max_files': 7,
    'max_total_bytes': 32 * 1024 ** 2, 'regular_files_only': True,
    'reject_symlinks_and_hardlinks': True, 'sanitize_before_export': True,
}


def resource_plan(cpu, memory, heap):
    return {
        'version': 1, 'cpu': cpu, 'memory_bytes': memory,
        'disk_budget_bytes': 30 * GIB, 'disk_budget_is_hard_quota': False,
        'node_heap_mib': heap, 'runtime_seconds': 2700, 'stop_seconds': 30,
        'tasks_max': 512, 'workers': 2, 'measured_minimum': False,
        'admission': {'control_cpu_target': 2, 'control_memory_target_bytes': 8 * GIB,
                      'headroom_guaranteed': False,
                      'requires_fresh_host_pressure_and_capacity': True,
                      'rounded_marketing_ram_not_authoritative': True},
    }


PLANS = (resource_plan(4, 8 * GIB, 3072), resource_plan(14, 20 * GIB, 6144))


def validate(value):
    if type(value) is not dict or type(value.get('name')) is not str:
        raise PermissionError('fixed_worker_descriptor_required')
    if value['name'] in FIXTURES:
        if set(value) != BASE_KEYS:
            raise PermissionError('legacy_fixture_descriptor_fields_required')
        return value
    if (value['name'] not in REAL or set(value) != KEYS
            or type(value['version']) is not int or value['version'] != 2
            or value['program'] != PROGRAM or value['python_path'] != PYTHON):
        raise PermissionError('fixed_real_profile_v2_required')
    for key in ('program_sha256', 'python_sha256', 'source_sha256',
                'dependencies_sha256', 'artifact_policy_sha256', 'plan_sha256'):
        contract.hex_value(value[key], 64)
    # Canonical comparison rejects bool-as-int and all extra nested fields.
    policy_raw = contract.canonical(value['artifact_policy'])
    if policy_raw != contract.canonical(POLICY) or contract.digest(value['artifact_policy']) != value['artifact_policy_sha256']:
        raise PermissionError('fixed_sealed_artifact_policy_required')
    resources = contract.canonical(value['resources'])
    if resources not in {contract.canonical(plan) for plan in PLANS}:
        raise PermissionError('reviewed_numeric_resource_plan_required')
    return value


def systemd_properties(value):
    validate(value)
    if value['name'] not in REAL:
        raise PermissionError('real_profile_resource_mapping_only')
    resource = value['resources']
    return {'CPUQuota': str(resource['cpu'] * 100) + '%',
            'MemoryMax': str(resource['memory_bytes']), 'MemorySwapMax': '0',
            'TasksMax': str(resource['tasks_max']),
            'RuntimeMaxSec': str(resource['runtime_seconds']),
            'TimeoutStartSec': '120', 'TimeoutStopSec': str(resource['stop_seconds'])}


def capacity(value, storage_root):
    """Fresh conservative preflight; this is not an enduring reservation."""
    validate(value)
    if value['name'] not in REAL:
        return
    resource = value['resources']
    fields = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, data = line.split(':', 1)
        if key in {'MemTotal', 'MemAvailable'}:
            size, unit = data.split()
            if unit != 'kB':
                raise PermissionError('actual_memory_units_required')
            fields[key] = int(size) * 1024
    reserve = resource['admission']['control_memory_target_bytes']
    if (set(fields) != {'MemTotal', 'MemAvailable'}
            or resource['memory_bytes'] + reserve > min(fields.values())
            or resource['cpu'] + resource['admission']['control_cpu_target'] > len(os.sched_getaffinity(0))):
        raise PermissionError('fresh_worker_capacity_insufficient')
    pressure = Path('/proc/pressure/memory').read_text().splitlines()
    some = [line for line in pressure if line.startswith('some ')]
    if len(some) != 1:
        raise PermissionError('memory_pressure_observation_required')
    rows = dict(piece.split('=') for piece in some[0].split()[1:])
    avg = float(rows['avg10'])
    if not 0 <= avg <= 1.0:
        raise PermissionError('worker_memory_pressure_high_or_invalid')
    disk = os.statvfs(storage_root)
    if disk.f_bavail * disk.f_frsize < resource['disk_budget_bytes'] + 2 * GIB:
        raise PermissionError('fresh_project_disk_capacity_insufficient')


def copy_artifacts(source, stage, descriptor):
    """Caller must already hold the bound native stop/cgroup proof.

    Only the fixed flat sanitized artifacts tree is exported. No workload
    source, DB, browser state or logs elsewhere in the StateDirectory are read.
    Artifacts never supply the root-authored result/unit stop/retirement proofs.
    """
    import artifacts
    validate(descriptor)
    if descriptor['name'] not in REAL:
        raise PermissionError('real_profile_export_policy_only')
    source, stage = Path(source), Path(stage)
    original = source / 'artifacts'
    if not os.path.lexists(original):
        return
    for parent in [*reversed(original.parents), original]:
        if parent.is_symlink():
            raise PermissionError('profile_artifact_ancestry_link')
    if not original.is_dir():
        raise PermissionError('profile_artifact_directory_required')
    entries = list(original.iterdir())
    if len(entries) > POLICY['max_files']:
        raise PermissionError('profile_artifact_count_exceeded')
    total = 0
    for path in sorted(entries):
        info = path.lstat()
        if (path.name not in POLICY['allowlist'] or not stat.S_ISREG(info.st_mode)
                or info.st_nlink != 1 or info.st_size > POLICY['max_file_bytes']):
            raise PermissionError('fixed_regular_profile_artifact_required')
        raw = artifacts.file_bytes(path, min(POLICY['max_file_bytes'], POLICY['max_total_bytes'] - total))
        total += len(raw)
        if total > POLICY['max_total_bytes']:
            raise PermissionError('profile_artifact_total_exceeded')
        artifacts.private_parents(stage, 'artifacts')
        destination = stage / 'artifacts' / path.name
        fd = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as out:
            out.write(raw)
            out.flush()
            os.fsync(out.fileno())
