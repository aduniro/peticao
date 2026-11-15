"""Future non-root namespace payload. Not installed or invoked by this package."""
import json
import os
from pathlib import Path
import re
import socket
import sys

ALIAS = Path('/run/peticao-dev-work')
PROJECT = Path('/mnt/apps/peticao-final/.runtime')


def unix_roundtrip(path):
    path = Path(path)
    if len(os.fsencode(path)) > 107 or path.exists() or path.is_symlink():
        raise ValueError('new short socket path required')
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as server:
        server.settimeout(2)
        server.bind(str(path))
        server.listen(1)
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(2)
                client.connect(str(path))
                connection, _ = server.accept()
                with connection:
                    connection.settimeout(2)
                    client.sendall(b'fixture')
                    if connection.recv(7) != b'fixture':
                        raise ValueError('socket exchange differs')
        finally:
            path.unlink()
    return True


def stat_pair(path):
    info = Path(path).stat()
    return [info.st_dev, info.st_ino]


def main(job):
    if not re.fullmatch('[a-f0-9]{32}', job) or os.geteuid() == 0:
        raise PermissionError('fixed job and non-root identity required')
    os.umask(0o077)
    state = Path('/var/lib/peticao-dev-job-' + job + '-g1')
    if Path.cwd() != ALIAS or os.environ.get('TMPDIR') != str(ALIAS / 't'):
        raise PermissionError('exact namespace alias and TMPDIR required')
    if (ALIAS / 't').exists():
        raise FileExistsError('fresh attempt only')
    (ALIAS / 't').mkdir(mode=0o700)
    sock = ALIAS / 't/.s.PGSQL.65432'
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    interfaces = [line.split(':', 1)[0].strip() for line in Path('/proc/net/dev').read_text().splitlines()[2:] if ':' in line]
    result = {
        'alias': str(ALIAS), 'logical_state': str(state), 'uid': os.geteuid(),
        'alias_stat': stat_pair(ALIAS), 'state_stat': stat_pair(state),
        'mount_namespace': Path('/proc/self/ns/mnt').stat().st_ino,
        'run_stat': stat_pair('/run'),
        'run_filesystem': None,
        'zero_capabilities': all(int(status.get(k, '1').strip(), 16) == 0 for k in ('CapEff', 'CapPrm', 'CapBnd')),
        'no_new_privileges': status.get('NoNewPrivs', '').strip() == '1',
        'private_network': interfaces == ['lo'],
        'physical_path_hidden': not os.access(PROJECT, os.R_OK | os.X_OK),
        'system_tmp_inaccessible': all(not os.access(p, os.R_OK | os.W_OK | os.X_OK) for p in ('/tmp', '/var/tmp')),
        'socket_path': str(sock), 'roundtrip': unix_roundtrip(sock),
    }
    run_mounts = []
    for line in Path('/proc/self/mountinfo').read_text().splitlines():
        before, separator, after = line.partition(' - ')
        fields = before.split()
        if separator and len(fields) >= 6 and fields[4] == '/run':
            run_mounts.append(after.split()[0])
    if len(run_mounts) == 1:
        result['run_filesystem'] = run_mounts[0]
    # Public synthetic evidence only, retained on the project-backed filesystem.
    with (ALIAS / 'alias-proof.json').open('x') as stream:
        json.dump(result, stream, sort_keys=True)
        stream.flush()
        os.fsync(stream.fileno())
    print(json.dumps({'probe_completed': True, 'profiles_qualified': False}))


if __name__ == '__main__':
    if len(sys.argv) != 2:
        raise SystemExit('fixed job ID required')
    main(sys.argv[1])
