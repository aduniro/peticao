"""Preparation only. No SSH, mount, systemd or operational queue operations."""
import re
from pathlib import PurePosixPath

ALIAS = '/run/peticao-dev-work'
PROJECT = '/mnt/apps/peticao-final/.runtime'
PROGRAM = '/opt/peticao-dev-short-alias-probe-20261115/probe.py'


def identifier(value):
    if type(value) is not str or not re.fullmatch('[a-f0-9]{32}', value):
        raise ValueError('fixed job identity required')
    return value


def socket_path(path):
    if (type(path) is not str or not path.startswith(ALIAS + '/t/')
            or '..' in PurePosixPath(path).parts or str(PurePosixPath(path)) != path
            or '\0' in path or len(path.encode()) > 107):
        raise ValueError('project-backed short UNIX socket path required')
    return path


def proposed_properties(job):
    """Properties to merge into a NEW reviewed adapter, never execute here.

    Existing ProjectStorage must bind its project backing to StateDirectory
    BEFORE systemd creates the job's alias. The actual adapter and executor
    are deliberately not duplicated in this package.
    """
    job = identifier(job)
    state = 'peticao-dev-job-' + job + '-g1'
    logical = '/var/lib/' + state
    return {
        'DynamicUser': 'yes', 'StateDirectory': state,
        'StateDirectoryMode': '0700', 'WorkingDirectory': ALIAS,
        'BindPaths': logical + ':' + ALIAS,
        'ProtectSystem': 'strict', 'ProtectHome': 'tmpfs',
        'PrivateNetwork': 'yes', 'PrivateDevices': 'yes', 'PrivateTmp': 'yes',
        'TemporaryFileSystem': '/run:rw',
        'NoNewPrivileges': 'yes', 'CapabilityBoundingSet': '',
        'AmbientCapabilities': '', 'RestrictSUIDSGID': 'yes',
        'InaccessiblePaths': '/tmp /var/tmp ' + PROJECT + ' -/run/docker.sock -/run/tailscale',
        'CPUQuota': '100%', 'MemoryMax': '256M', 'TasksMax': '32',
        'RuntimeMaxSec': '60', 'KillMode': 'control-group', 'UMask': '0077',
    }


def stat_pair(value):
    return (type(value) is list and len(value) == 2
            and all(type(x) is int and x >= 0 for x in value) and value[1] > 0)


def validate_observation(job, child, host_before, host_after, physical, host_during=None):
    """Validate evidence supplied by a future trusted root executor.

    This pure function is not proof that such an executor ran. Host evidence
    must come from the pinned manager namespace and ProjectStorage verifier.
    """
    job = identifier(job)
    expected = '/var/lib/peticao-dev-job-' + job + '-g1'
    if child.get('alias') != ALIAS or child.get('logical_state') != expected:
        raise ValueError('alias and StateDirectory binding differ')
    if type(child.get('uid')) is not int or child['uid'] <= 0:
        raise ValueError('non-root runtime required')
    for name in ('zero_capabilities', 'no_new_privileges', 'private_network',
                 'physical_path_hidden', 'system_tmp_inaccessible', 'roundtrip'):
        if child.get(name) is not True:
            raise ValueError('missing namespace proof: ' + name)
    if type(physical.get('device')) is not int or type(physical.get('inode')) is not int:
        raise ValueError('actual physical stat required')
    identity = [physical['device'], physical['inode']]
    if not stat_pair(identity) or not stat_pair(child.get('alias_stat')) or not stat_pair(child.get('state_stat')):
        raise ValueError('strict numeric device and inode pairs required')
    if child.get('alias_stat') != identity or child.get('state_stat') != identity:
        raise ValueError('physical backing differs')
    for observation in (host_before, host_during, host_after):
        if type(observation) is not dict:
            raise ValueError('host observations before, during and after required')
        if observation.get('manager_namespace_verified') is not True or observation.get('alias_exists') is not False:
            raise ValueError('alias must not be published in host namespace')
        if type(observation.get('mount_namespace')) is not int or observation['mount_namespace'] <= 0:
            raise ValueError('actual manager namespace identity required')
        if not stat_pair(observation.get('run_stat')):
            raise ValueError('actual manager run stat required')
    if (len({host_before['mount_namespace'], host_during['mount_namespace'], host_after['mount_namespace']}) != 1
            or type(child.get('mount_namespace')) is not int or child['mount_namespace'] <= 0):
        raise ValueError('stable manager and actual child namespaces required')
    if host_before.get('mount_namespace') == child.get('mount_namespace'):
        raise ValueError('job must have separate mount namespace')
    if (child.get('run_filesystem') != 'tmpfs' or not stat_pair(child.get('run_stat'))
            or any(child['run_stat'] == observation['run_stat'] for observation in (host_before, host_during, host_after))):
        raise ValueError('private run tmpfs distinct from manager required')
    source = physical.get('source', '')
    if (type(source) is not str or not source.startswith(PROJECT + '/')
            or '..' in PurePosixPath(source).parts):
        raise ValueError('physical source must be project-backed')
    socket_path(child['socket_path'])
    return {'scope': 'short-alias-only', 'evidence_consistent': True,
            'operational_ready': False, 'profiles_qualified': False, 'cutover': False}
