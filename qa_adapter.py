"""Fixed new QA100 adapter. SOURCE ONLY; no execution or installation on import.

The driver supplies a sealed context, a NEW same-job compiled export and a
pidfd supervisor. This adapter never starts historical executors, proves a Root
stop/cgroup/custody, or qualifies missing runtime pins. Tools/closure/Python
inventory and IPC gates fail closed BEFORE launching Node/PG/browser children.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

TOOLS = Path('/opt/peticao-dev-profile-tools-v1')
QA_FILES = frozenset('qa/' + name for name in (
    'common.mjs', 'node-owned.mjs', 'qa-driver.mjs', 'qa-runtime.mjs', 'fixture.ts',
    'backend-smoke.mjs', 'http-regression.mjs', 'refresh-fixture-session.mjs',
    'browser-bootstrap.py', 'browser40.py', 'maps2.py', 'network-guard.cjs',
    'build-guard.mjs', 'python-runtime.json'))
COUNTS = {'backend': 43, 'http': 7, 'browser': 40, 'maps': 2, 'http_reset': 8}
MAX_PRIVATE = 1048576
UNIX_LIMIT = 108
QA_TIMEOUT = 1200


class QAPending(RuntimeError):
    pass


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _exact(value, names):
    if type(value) is not dict or set(value) != set(names):
        raise QAPending('exact_qa_receipt_required')


def _integer(value):
    if type(value) is not int or not 0 <= value <= 1000000:
        raise QAPending('bounded_qa_count_required')


def _pairs(rows):
    value = {}
    for key, item in rows:
        if key in value:
            raise QAPending('duplicate_qa_json_key')
        value[key] = item
    return value


def _nonfinite(_):
    raise QAPending('nonfinite_qa_json_refused')


def _chain(path, root_controlled=False):
    path = Path(path).absolute()
    if '..' in path.parts:
        raise QAPending('canonical_qa_path_required')
    for item in [*reversed(path.parents), path]:
        i = item.lstat()
        if stat.S_ISLNK(i.st_mode) or (root_controlled and (i.st_uid != 0 or i.st_mode & 0o022)):
            raise QAPending('trusted_qa_path_required')
    return path


def _read(path, *, maximum=MAX_PRIVATE, uid=None, private=True):
    path = _chain(path, root_controlled=not private)
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        before = os.fstat(fd)
        expected = os.geteuid() if uid is None else uid
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != expected or before.st_nlink != 1
                or (stat.S_IMODE(before.st_mode) != 0o600 if private else bool(before.st_mode & 0o022))
                or before.st_size > maximum):
            raise QAPending('bounded_owned_qa_file_required')
        raw = bytearray()
        while len(raw) <= maximum:
            block = os.read(fd, min(65536, maximum + 1 - len(raw)))
            if not block:
                break
            raw.extend(block)
        after = os.fstat(fd)
        named = path.lstat()
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')
        if len(raw) != before.st_size or len(raw) > maximum or any(getattr(before, k) != getattr(after, k) or getattr(before, k) != getattr(named, k) for k in fields):
            raise QAPending('qa_file_changed_while_reading')
        return bytes(raw)
    finally:
        os.close(fd)


def _json(path, **kwargs):
    try:
        return json.loads(_read(path, **kwargs), object_pairs_hook=_pairs, parse_constant=_nonfinite)
    except (ValueError, UnicodeError, TypeError, RecursionError):
        raise QAPending('bounded_strict_qa_json_required') from None


def _verify_context(ctx):
    for key, expected in (('tools', TOOLS), ('node', TOOLS / 'node20'),
                          ('python', TOOLS / 'python312/bin/python3.12'),
                          ('chromium', TOOLS / 'chromium/chrome-linux64/chrome')):
        if Path(getattr(ctx, key)) != expected:
            raise QAPending('fixed_pinned_qa_tool_paths_required')
    root = _chain(ctx.root)
    if Path(ctx.site) != root / 'source/site' or Path(ctx.compiled) != root / 'compiled':
        raise QAPending('same_job_source_and_new_compiled_export_required')
    i = root.stat()
    if not stat.S_ISDIR(i.st_mode) or i.st_uid != os.geteuid() or stat.S_IMODE(i.st_mode) != 0o700:
        raise QAPending('private_owned_job_root_required')
    for path in (ctx.site, ctx.compiled):
        if not _chain(path).is_dir():
            raise QAPending('prepared_same_job_input_directory_required')
    inventory = getattr(ctx, 'qa_inventory', None)
    sha = getattr(ctx, 'qa_closure_sha256', None)
    if type(inventory) is not dict or set(inventory) != QA_FILES or type(sha) is not str or not re.fullmatch('[a-f0-9]{64}', sha):
        raise QAPending('complete_pinned_qa_closure_required')
    if hashlib.sha256(_canonical(inventory).encode()).hexdigest() != sha:
        raise QAPending('qa_closure_inventory_digest_mismatch')
    if {item.name for item in _chain(TOOLS / 'qa', True).iterdir()} != {Path(name).name for name in QA_FILES}:
        raise QAPending('unexpected_public_qa_member')
    for name, row in inventory.items():
        _exact(row, {'sha256', 'bytes'})
        if type(row['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}', row['sha256']) or type(row['bytes']) is not int or not 0 < row['bytes'] <= 4194304:
            raise QAPending('exact_qa_file_pin_required')
        raw = _read(TOOLS / name, maximum=4194304, uid=0, private=False)
        if len(raw) != row['bytes'] or hashlib.sha256(raw).hexdigest() != row['sha256']:
            raise QAPending('pinned_qa_helper_changed')
    runtime = _json(TOOLS / 'qa/python-runtime.json', maximum=4194304, uid=0, private=False)
    _verify_python_runtime(runtime)
    return root


def _verify_python_runtime(runtime):
    _exact(runtime, {'version', 'site_root', 'source_wheels', 'files'})
    if (type(runtime['version']) is not int or runtime['version'] != 1
            or runtime['site_root'] != str(TOOLS / 'python-wheels/site')
            or type(runtime['files']) is not dict or not 1 <= len(runtime['files']) <= 20000):
        raise QAPending('verified_python_wheels_runtime_inventory_pending')
    names = {'greenlet-3.5.6-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl',
             'playwright-1.62.0-py3-none-manylinux1_x86_64.whl', 'pyee-13.0.1-py3-none-any.whl',
             'typing_extensions-4.16.0-py3-none-any.whl'}
    rows = runtime['source_wheels']
    if type(rows) is not list or len(rows) != 4:
        raise QAPending('four_verified_source_wheels_required')
    for row in rows:
        _exact(row, {'name', 'sha256', 'bytes'})
        if type(row['name']) is not str:
            raise QAPending('fixed_source_wheel_name_required')
    if {row['name'] for row in rows} != names:
        raise QAPending('four_verified_source_wheels_required')
    expected = {}
    for row in rows:
        if type(row['bytes']) is not int or row['bytes'] <= 0:
            raise QAPending('nonempty_source_wheel_required')
        expected[TOOLS / 'python-wheels' / row['name']] = {key: row[key] for key in ('sha256', 'bytes')}
    site = _chain(TOOLS / 'python-wheels/site', True)
    actual = set()
    for path in site.rglob('*'):
        info = path.lstat()
        if not (stat.S_ISDIR(info.st_mode) or stat.S_ISREG(info.st_mode)) or stat.S_ISLNK(info.st_mode):
            raise QAPending('normalized_python_runtime_regular_only')
        if stat.S_ISREG(info.st_mode):
            actual.add(path.relative_to(site).as_posix())
    if actual != set(runtime['files']):
        raise QAPending('complete_python_runtime_member_inventory_required')
    for name, row in runtime['files'].items():
        if (type(name) is not str or not name or Path(name).is_absolute() or '..' in Path(name).parts
                or name != Path(name).as_posix() or Path(name).suffix in {'.pth', '.pyc'} or '__pycache__' in Path(name).parts):
            raise QAPending('no_python_site_pth_or_mutable_cache')
        expected[site / name] = row
    for path, row in expected.items():
        _exact(row, {'sha256', 'bytes'})
        if type(row['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}', row['sha256']) or type(row['bytes']) is not int or not 0 <= row['bytes'] <= 536870912:
            raise QAPending('complete_python_runtime_file_pin_required')
        raw = _read(path, maximum=row['bytes'], uid=0, private=False)
        if len(raw) != row['bytes'] or hashlib.sha256(raw).hexdigest() != row['sha256']:
            raise QAPending('python_runtime_file_pin_mismatch')


def measure_ipc(root, relative_tmp='private-qa/t', relative_home='private-qa/e'):
    """Conservative pre-execution measurement; does not qualify Chromium IPC."""
    root = Path(root)
    result = {}
    for label, relative, suffix in (
        ('tmp', relative_tmp, '/playwright_chromiumdev_profile-XXXXXXXXXXXX/SingletonSocket'),
        ('home', relative_home, '/.config/chromium/SingletonSocket')):
        if type(relative) is not str or Path(relative).is_absolute() or '..' in Path(relative).parts:
            raise QAPending('relative_private_ipc_paths_required')
        literal = relative + suffix
        absolute = str(root / relative) + suffix
        result[label] = {'relative_bytes': len(os.fsencode(literal)), 'absolute_bytes': len(os.fsencode(absolute)), 'limit': UNIX_LIMIT}
        if max(result[label]['relative_bytes'], result[label]['absolute_bytes']) >= UNIX_LIMIT:
            raise QAPending('qa_unix_ipc_path_budget_requires_infra_qualification')
    # PostgreSQL is TCP-only; unix_socket_directories is explicitly empty.
    return result


def _prepare(root):
    private = root / 'private-qa'
    private.mkdir(mode=0o700)  # Exclusive; no existing fixture/DB/output reuse.
    for name in ('e', 't', 'c', 'g', 'r', 'outbox', 'results'):
        (private / name).mkdir(mode=0o700)
    for path in (private, root):
        fd = os.open(path, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    return private


def _summary(private, require_pass=True):
    report = _json(private / 'QA-SUMMARY.json')
    _exact(report, {'version', 'counts', 'passed', 'page_errors', 'blocked_writes', 'fixture_only', 'refreshed', 'cleanup'})
    if type(report['version']) is not int or report['version'] != 1:
        raise QAPending('qa_version_one_required')
    _exact(report['counts'], COUNTS)
    for count in report['counts'].values():
        _integer(count)
    for key in ('passed', 'fixture_only', 'refreshed'):
        if type(report[key]) is not bool:
            raise QAPending('typed_qa_boolean_required')
    for key in ('page_errors', 'blocked_writes'):
        _integer(report[key])
    _exact(report['cleanup'], {'runtime_stopped', 'forced', 'app_stopped', 'pg_stopped'})
    if any(type(item) is not bool for item in report['cleanup'].values()):
        raise QAPending('typed_qa_drain_required')
    valid = (report['passed'] is True and report['fixture_only'] is True and report['refreshed'] is True
             and report['counts'] == COUNTS and report['page_errors'] == 0 and report['blocked_writes'] == 0
             and report['cleanup'] == {'runtime_stopped': True, 'forced': False, 'app_stopped': True, 'pg_stopped': True})
    if report['fixture_only'] is not True:
        raise QAPending('fictional_qa_fixture_only')
    if require_pass and not valid:
        raise QAPending('actual_qa100_refresh_and_owned_drain_required')
    if report['passed'] and not valid:
        raise QAPending('incoherent_qa_pass_receipt')
    return {key: report[key] for key in ('version', 'counts', 'passed', 'page_errors', 'blocked_writes', 'fixture_only')}


def _network(private, passed):
    path = private / 'network-denials.jsonl'
    denied = 0
    if path.exists():
        raw = _read(path)
        for line in raw.splitlines():
            try:
                value = json.loads(line)
            except (ValueError, UnicodeError, TypeError):
                raise QAPending('bounded_network_denial_json_required') from None
            _exact(value, {'kind'})
            if type(value['kind']) is not str or value['kind'] not in {'tcp', 'unix', 'dns', 'tls', 'udp', 'fetch'}:
                raise QAPending('fixed_network_denial_kind_required')
            denied += 1
    return {'version': 1, 'mode': 'offline-loopback-fixtures', 'external_allowed': False,
            'attempts_denied': denied, 'unexpected_attempts': denied,
            'fixture_pg_loopback': passed, 'fixture_http_loopback': passed}


def run_qa(ctx, supervisor):
    root = _verify_context(ctx)
    measure_ipc(root)  # Never convert TMPDIR/HOME into absolute env values.
    env = dict(ctx.env_for(root, 'qa'))
    env.update({name: 'private-qa/' + target for name, target in (
        ('HOME', 'e'), ('TMPDIR', 't'), ('TMP', 't'), ('TEMP', 't'),
        ('XDG_CACHE_HOME', 'c'), ('XDG_CONFIG_HOME', 'g'), ('XDG_RUNTIME_DIR', 'r'))})
    options = env.get('NODE_OPTIONS')
    if options not in {f'--require={TOOLS}/qa/network-guard.cjs --max-old-space-size=3072', f'--require={TOOLS}/qa/network-guard.cjs --max-old-space-size=6144'}:
        raise QAPending('fixed_qa_network_guard_required')
    env.update(PROFILE_TOOLS_ROOT=str(TOOLS), NODE=str(ctx.node), PYTHON=str(ctx.python), CHROMIUM=str(ctx.chromium),
               QA_ROOT='private-qa', WHEELS_ROOT=str(TOOLS / 'python-wheels/site'), PLAYWRIGHT_NODEJS_PATH=str(ctx.node))
    private = _prepare(root)
    def observed():
        result = _summary(private, require_pass=True)
        return sum(result['counts'].values())
    phase = supervisor.run('qa100', [str(ctx.node), str(TOOLS / 'qa/qa-driver.mjs')], cwd='.', env=env,
                           timeout=QA_TIMEOUT, expected_checks=100, observed_checks=observed)
    try:
        summary = _summary(private, require_pass=phase['success'])
    except (OSError, QAPending):
        if phase['success']:
            raise
        summary = {'version': 1, 'counts': {key: 0 for key in COUNTS}, 'passed': False, 'page_errors': 0, 'blocked_writes': 0, 'fixture_only': True}
    if not phase['success']:
        summary['passed'] = False
    return {'phases': [phase], 'summary': summary, 'network': _network(private, summary['passed']),
            'log_path': supervisor.log_path('qa100')}
