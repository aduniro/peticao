"""One-shot numeric capacity observation. No shell, writes, launch or auth."""
import json
import os
from pathlib import Path
import socket
import time

GIB = 1024 ** 3


def candidate(total, available, cpus):
    if any(type(x) is not int or x <= 0 for x in (total, available, cpus)) or available > total:
        raise ValueError('positive_actual_capacity_required')
    # Preserve an explicit 6GiB total headroom and 4GiB presently available.
    # This is a conservative candidate, never admission or a reservation.
    ceiling = min(total - 6 * GIB, available - 4 * GIB)
    memory = next((g * GIB for g in (24, 20, 16, 12, 8) if g * GIB <= ceiling), None)
    return {'memory_max_bytes': memory, 'cpu_quota_percent': max(0, cpus - 2) * 100,
            'minimum_total_headroom_bytes': 6 * GIB,
            'minimum_available_headroom_bytes': 4 * GIB,
            'eligible_capacity_candidate': memory is not None and cpus >= 4,
            'qualified': False, 'reservation_created': False,
            'requires_fresh_prelaunch_measurement': True}


def collect():
    if socket.gethostname() != 'peticao-civo':
        raise PermissionError('civo_capacity_observation_only')
    memory = {}
    for line in Path('/proc/meminfo').read_text().splitlines():
        key, value = line.split(':', 1)
        parts = value.split()
        if key in {'MemTotal', 'MemAvailable', 'SwapTotal', 'SwapFree'}:
            if len(parts) != 2 or parts[1] != 'kB':
                raise ValueError('kernel_memory_unit_required')
            memory[key] = int(parts[0]) * 1024
    cpu_count = len(os.sched_getaffinity(0))
    pressure = {}
    for resource in ('memory', 'cpu', 'io'):
        pressure[resource] = {}
        for line in (Path('/proc/pressure') / resource).read_text().splitlines():
            name, *fields = line.split()
            pressure[resource][name] = {k: float(v) for k, v in (x.split('=') for x in fields)}
    root = Path('/sys/fs/cgroup')
    cgroup = {}
    for name in ('memory.current', 'memory.max', 'memory.swap.current', 'memory.swap.max', 'cpu.max'):
        file = root / name
        if file.is_file():
            raw = file.read_text().strip()
            if not all(x.isdecimal() or x == 'max' for x in raw.split()):
                raise ValueError('kernel_cgroup_value_required')
            cgroup[name] = raw
    return {'version': 1, 'observed_unix': time.time(), 'host': 'peticao-civo',
            'memory_bytes': memory, 'affinity_cpus': cpu_count,
            'pressure': pressure, 'root_cgroup': cgroup,
            'candidate': candidate(memory['MemTotal'], memory['MemAvailable'], cpu_count),
            'services_modified': False, 'dispatch_enabled': False}


if __name__ == '__main__':
    print(json.dumps(collect(), sort_keys=True, allow_nan=False))
