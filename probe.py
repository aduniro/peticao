"""Read-only namespace metadata. Never opens home files or enumerates filenames."""
import argparse
import itertools
import json
import os
from pathlib import Path
import re
import stat

PATHS = ('/home', '/home/civo', '/root', '/run/user')
CHILD_LIMIT = 1000
SAFE_OPTION_KEYS = {'size', 'nr_inodes', 'mode', 'uid', 'gid'}
SAFE_FLAGS = {'ro', 'rw', 'nosuid', 'nodev', 'noexec', 'relatime', 'noatime', 'strictatime', 'lazytime', 'sync', 'async', 'seclabel'}


def unescape_mount(value):
    return re.sub(r'\\([0-7]{3})', lambda match: chr(int(match.group(1), 8)), value)


def safe_options(value):
    result = []
    for option in value.split(','):
        key, separator, number = option.partition('=')
        if option in SAFE_FLAGS or (separator and key in SAFE_OPTION_KEYS and re.fullmatch(r'[0-9]+[kKmMgG%]?', number)):
            result.append(option)
        else:
            result.append(key + '=redacted' if separator else 'other-option')
    return sorted(set(result))


def parse_mountinfo(raw):
    result = []
    for line in raw.splitlines():
        before, separator, after = line.partition(' - ')
        left, right = before.split(), after.split()
        if not separator or len(left) < 6 or len(right) < 3:
            continue
        point = unescape_mount(left[4])
        if point not in PATHS:
            continue
        fstype = right[0]
        result.append({'mountpoint': point, 'filesystem': fstype, 'mount_options': safe_options(left[5]), 'super_options': safe_options(right[2]), 'source': fstype if fstype in {'tmpfs', 'proc', 'sysfs', 'devtmpfs', 'ramfs'} else 'redacted', 'filesystem_root': 'whole' if unescape_mount(left[3]) == '/' else 'subtree'})
    return result


def metadata(value):
    path = Path(value)
    result = {'path': value, 'exists': False, 'readable': os.access(path, os.R_OK), 'writable': os.access(path, os.W_OK), 'executable': os.access(path, os.X_OK), 'mode': None, 'directory': False, 'symlink': False, 'child_count': None, 'child_count_limited': False, 'child_count_error': None, 'credential_directories_visible': {}}
    try:
        info = path.lstat()
        result.update(device=info.st_dev, inode=info.st_ino, socket=stat.S_ISSOCK(info.st_mode), exists=path.exists(), mode=format(stat.S_IMODE(info.st_mode), '04o'), directory=path.is_dir(), symlink=stat.S_ISLNK(info.st_mode))
    except OSError as error:
        result['metadata_error'] = type(error).__name__
    try:
        result['filesystem_read_only'] = bool(os.statvfs(path).f_flag & os.ST_RDONLY)
    except OSError as error:
        result['filesystem_read_only'] = None
        result['filesystem_error'] = type(error).__name__
    if result['directory']:
        try:
            with os.scandir(path) as entries:
                result['child_count'] = sum(1 for _ in itertools.islice(entries, CHILD_LIMIT))
            # Conservative: exactly LIMIT children is also reported as potentially truncated.
            result['child_count_limited'] = result['child_count'] == CHILD_LIMIT
        except OSError as error:
            result['child_count_error'] = type(error).__name__
    for name in ('.ssh', '.codex', '.config'):
        try:
            result['credential_directories_visible'][name] = (path / name).is_dir()
        except OSError:
            result['credential_directories_visible'][name] = False
    return result


def kernel_fields(raw):
    allowed = {'NoNewPrivs', 'CapEff', 'CapPrm', 'CapBnd', 'Seccomp'}
    return {key: value.strip() for line in raw.splitlines() for key, separator, value in [line.partition(':')] if separator and key in allowed}


def collect(extra_paths=None):
    # The only file contents read are these two kernel process metadata files.
    with open('/proc/self/mountinfo', 'r', encoding='utf-8') as stream:
        mounts = parse_mountinfo(stream.read())
    with open('/proc/self/status', 'r', encoding='utf-8') as stream:
        process = kernel_fields(stream.read())
    interfaces = []
    try:
        with os.scandir('/sys/class/net') as entries:
            interfaces = sorted(entry.name for entry in itertools.islice(entries, CHILD_LIMIT))
    except OSError:
        interfaces = None
    processes = 0
    try:
        with os.scandir('/proc') as entries:
            for entry in itertools.islice(entries, CHILD_LIMIT):
                processes += entry.name.isdecimal()
    except OSError:
        processes = None
    extra = list(dict.fromkeys(str(value) for value in (extra_paths or [])))
    return {'schema': 2, 'uid': os.geteuid(), 'gid': os.getegid(), 'groups': os.getgroups(), 'metadata_only': True, 'child_limit': CHILD_LIMIT, 'mounts': mounts, 'paths': [metadata(value) for value in PATHS], 'extra_paths': [metadata(value) for value in extra], 'process_security': process, 'network_interfaces': interfaces, 'loopback_only': interfaces == ['lo'], 'visible_numeric_process_entries': processes, 'proc_scan_limit': CHILD_LIMIT, 'socket_connect_test': 'not_performed_metadata_only'}


def report():
    return collect()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--path', action='append', default=[], help='Additional path for metadata only; repeat as needed')
    args = parser.parse_args()
    print(json.dumps(collect(args.path), sort_keys=True))
