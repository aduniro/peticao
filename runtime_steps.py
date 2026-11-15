"""Offline same-job preparation/build/export; no execution on import.

Only the sealed driver supplies ctx and Supervisor. New source/deps/compiled
outputs never reuse a cache or historical runtime. Hashes do not qualify the
original cache, dependency closure, workload, cgroup stop or custody.
"""
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import time

import driver_contract
import input_provider
import resource_plan

TOOLS = Path('/opt/peticao-dev-profile-tools-v1')
SOURCE = dict(driver_contract.SOURCE)
LOCK_SHA256 = '52963634411e4f0dcdb829d53a5c51d98eba853f87227930fae4a1c87f0abe74'
PDFJS_LOCK_SHA256 = 'da3a1d711714a7684e702312087c02b080acdb2bfdc1212d8543b3f455343922'
PDFJS_ARCHIVE_SHA256 = '7461aefcd27c4ef0dd76f9ca5760f09466eb6b3f934432670c12132e7b3d6faa'
MAX_FILE = 256 * 1024**2
MAX_TOTAL = 1024**3
MAX_FILES = 30000
BUILD_MARKERS = (b'PROFILE-FIXTURE-ONLY-NOT-PRODUCTION-v1', b'ProfileFixtureOnly-v1',
                 b'BUILD_ONLY_PEPPER_NOT_PRODUCTION_0123456789', b'BuildOnly-NotAProductionPassword')
PRIVATE_PARTS = {'.ssh', '.aws', '.gnupg', '.git', 'secrets', 'credentials', 'authorized_keys', 'id_rsa', 'id_ed25519'}


class RuntimePending(RuntimeError):
    pass


def _canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def _relative(name):
    if type(name) is not str:
        raise RuntimePending('contained_canonical_runtime_path_required')
    path = PurePosixPath(name)
    if (not name or path.is_absolute() or str(path) != name
            or '\\' in name or len(name.encode()) > 1024
            or any(part in {'', '.', '..'} for part in name.split('/'))
            or any(ord(char) < 32 or ord(char) == 127 for char in name)):
        raise RuntimePending('contained_canonical_runtime_path_required')
    return name


def _chain(path):
    path = Path(path).absolute()
    for item in [*reversed(path.parents), path]:
        if stat.S_ISLNK(item.lstat().st_mode):
            raise RuntimePending('runtime_path_symlink_forbidden')
    return path


def _read(path, maximum=MAX_FILE, *, scan=False):
    path = Path(path).absolute()
    parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parent.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent); parent = child
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno())
            if not stat.S_ISREG(before.st_mode) or before.st_nlink != 1 or not 0 <= before.st_size <= maximum:
                raise RuntimePending('bounded_single_link_regular_runtime_file_required')
            raw = stream.read(maximum + 1)
            named = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
            if (len(raw) > maximum or len(raw) != before.st_size
                    or input_provider._signature(before) != input_provider._signature(os.fstat(stream.fileno()))
                    or input_provider._signature(before) != input_provider._signature(named)):
                raise RuntimePending('runtime_file_changed_during_read')
    finally:
        os.close(parent)
    if scan and any(marker in raw for marker in BUILD_MARKERS):
        raise RuntimePending('build_only_marker_embedded')
    return raw


def _json(path, maximum=8 * 1024**2):
    try:
        value = json.loads(_read(path, maximum))
    except (ValueError, UnicodeError) as error:
        raise RuntimePending('bounded_valid_runtime_json_required') from error
    if type(value) is not dict:
        raise RuntimePending('runtime_json_object_required')
    return value


def _pin(path, sha, size=None):
    raw = _read(path)
    if hashlib.sha256(raw).hexdigest() != sha or size is not None and len(raw) != size:
        raise RuntimePending('runtime_input_pin_mismatch')
    return raw


def _public(path, sha, size):
    with input_provider.verified_input(path, sha, size) as stream:
        return stream.read()


def _context(ctx, supervisor):
    root = _chain(ctx.root)
    info = root.stat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700 or Path.cwd() != root:
        raise RuntimePending('trusted_current_private_job_root_required')
    if (Path(ctx.site) != root / 'source/site' or Path(ctx.compiled) != root / 'compiled'
            or Path(ctx.tools) != TOOLS or Path(ctx.node) != TOOLS / 'node20'
            or Path(ctx.python) != TOOLS / 'python312/bin/python3.12'):
        raise RuntimePending('fixed_same_job_paths_and_public_tools_required')
    if Path(supervisor.root) != root or supervisor.allowed_executables.get(str(ctx.node)) != driver_contract.NODE_SHA:
        raise RuntimePending('same_job_supervisor_with_fixed_node_pin_required')
    resource_plan.validate(ctx.resources)
    return root


def _state(ctx):
    state = getattr(ctx, '_runtime_steps_state', None)
    if type(state) is not dict:
        raise RuntimePending('fresh_offline_prepare_required')
    return state


def _safe_name(name, *, example=False):
    _relative(name)
    parts = PurePosixPath(name).parts
    if any(part.lower() in PRIVATE_PARTS for part in parts):
        raise RuntimePending('runtime_credentials_path_forbidden')
    if any(part.startswith('.env') and not (example and name == 'site/.env.example') for part in parts):
        raise RuntimePending('dotenv_input_forbidden')
    if not example and PurePosixPath(name).suffix.lower() in {'.key', '.pem', '.pfx', '.p12', '.sqlite', '.sqlite3', '.db', '.dump', '.sql'}:
        raise RuntimePending('raw_database_or_key_export_forbidden')


def _scan_source(ctx):
    source = Path(ctx.root) / 'source'
    count = 0
    for directory, dirs, files in os.walk(source, followlinks=False):
        parent = Path(directory)
        for name in list(dirs) + files:
            count += 1
            if count > 60000:
                raise RuntimePending('bounded_source_path_scan_required')
            path = parent / name
            relative = path.relative_to(source).as_posix()
            _safe_name(relative, example=True)
            if path.is_symlink():
                if path != Path(ctx.site) / 'node_modules' or os.readlink(path) != '../../deps/node_modules':
                    raise RuntimePending('only_job_dependency_link_permitted_in_source')
                if path.resolve(strict=True) != Path(ctx.root) / 'deps/node_modules':
                    raise RuntimePending('source_dependency_link_escape')
                if name in dirs:
                    dirs.remove(name)
            elif not path.is_dir() and not stat.S_ISREG(path.lstat().st_mode):
                raise RuntimePending('source_special_file_forbidden')


def _snapshot(ctx, manifest):
    result = {}
    for entry in manifest['entries']:
        if entry['type'] == 'file':
            name = _relative(entry['name'])
            path = Path(ctx.root) / 'source' / name
            _chain(path)
            raw = _read(path)
            if len(raw) != entry['size']:
                raise RuntimePending('extracted_source_size_mismatch')
            result[name] = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
    if not result:
        raise RuntimePending('original_source_inventory_required')
    return result


def _verify_source(ctx):
    for name, row in _state(ctx)['source_files'].items():
        path = Path(ctx.root) / 'source' / _relative(name)
        _chain(path); _pin(path, row['sha256'], row['bytes'])
    _scan_source(ctx)
    return 1


def _private_build(root):
    path = root / 'private-build'
    path.mkdir(mode=0o700)
    for name in ('e', 't', 'c', 'g', 'r', 'outbox'):
        (path / name).mkdir(mode=0o700)
    return path


def _environment(ctx, phase):
    cwd = Path(ctx.site)
    env = dict(ctx.env_for(cwd, phase))
    fixed = {'NODE_ENV': 'production', 'MAIL_PROVIDER': 'dev', 'MAIL_PROVIDERS': 'dev',
             'CRON_SECRET': '', 'WHATSAPP_ENABLED': '0', 'NEXT_TELEMETRY_DISABLED': '1',
             'DATABASE_URL': 'postgres://build:build@127.0.0.1:1/build', 'NEXT_BUILD_CPUS': '2',
             'HASH_PEPPER': 'PROFILE-FIXTURE-ONLY-NOT-PRODUCTION-v1', 'ADMIN_PASSWORD': 'ProfileFixtureOnly-v1'}
    for key, value in fixed.items():
        if key in env and env[key] != value:
            raise RuntimePending('fixed_offline_build_environment_required')
        env[key] = value
    if 'PREVIEW_MODE' in env or 'ADMIN_NO_PASSWORD' in env or 'ADMIN_PASSWORD_FILE' in env:
        raise RuntimePending('preview_or_external_password_environment_forbidden')
    for name, target in (('HOME', 'e'), ('TMPDIR', 't'), ('TMP', 't'), ('TEMP', 't'),
                         ('XDG_CACHE_HOME', 'c'), ('XDG_CONFIG_HOME', 'g'), ('XDG_RUNTIME_DIR', 'r'),
                         ('SECRETS_DIR', 'e'), ('PETICAO_CONFIG_DIR', 'e'), ('CREDENTIALS_DIRECTORY', 'e'), ('GEO_DIR', 'e'), ('MAIL_OUTBOX_DIR', 'outbox')):
        env[name] = os.path.relpath(Path(ctx.root) / 'private-build' / target, cwd)
    heap = '--max-old-space-size=' + str(ctx.resources['node_heap_mib'])
    env['NODE_OPTIONS'] = ('--import=' + str(TOOLS / 'qa/build-guard.mjs') + ' ' if phase == 'build' else '') + heap
    return env


def _pdf_lock(ctx):
    path = Path(ctx.site) / 'scripts/pdfjs-assets.lock.json'
    _pin(path, PDFJS_LOCK_SHA256)
    value = _json(path)
    if (value.get('package') != 'pdfjs-dist' or value.get('version') != '6.5.438'
            or type(value.get('archiveSize')) is not int or not 0 < value['archiveSize'] <= 32000000
            or type(value.get('files')) is not dict or not 1 <= len(value['files']) <= 2500):
        raise RuntimePending('fixed_bounded_pdfjs_lock_required')
    for row in value['files'].values():
        if type(row) is not dict or set(row) != {'path', 'size', 'sha256'}:
            raise RuntimePending('exact_pdfjs_file_pin_required')
        _safe_name(row['path'])
        if type(row['size']) is not int or not 0 < row['size'] <= 32000000 or not re.fullmatch('[a-f0-9]{64}', str(row['sha256'])):
            raise RuntimePending('bounded_pdfjs_file_pin_required')
    return value


def _pdf_ready(ctx):
    lock = _pdf_lock(ctx)
    destination = Path(ctx.site) / 'public/vendor/pdfjs/6.5.438'
    for row in lock['files'].values():
        path = destination / row['path']; _chain(path); _pin(path, row['sha256'], row['size'])
    version = _json(destination / 'assets-version.json', 65536)
    if version != {'version': '6.5.438', 'archiveIntegrity': lock['archiveIntegrity'], 'assets': len(lock['files'])}:
        raise RuntimePending('complete_pdfjs_assets_receipt_required')
    _verify_source(ctx)
    return 1


def prepare(ctx, supervisor):
    root = _context(ctx, supervisor)
    if hasattr(ctx, '_runtime_steps_state'):
        raise RuntimePending('offline_prepare_no_replay')
    ctx._runtime_steps_state = {'started': True}
    archive = ctx.dependencies.get('normalized_archive', {})
    if (archive.get('path') != str(TOOLS / 'inputs/dependencies.normalized.tar.gz')
            or type(archive.get('sha256')) is not str or not re.fullmatch('[a-f0-9]{64}', archive['sha256'])
            or type(archive.get('bytes')) is not int or archive['bytes'] <= 0):
        raise RuntimePending('reviewed_normalized_dependency_archive_required')
    if any(os.path.lexists(root / name) for name in ('source', 'deps', 'compiled', 'private-build')):
        raise RuntimePending('fresh_same_job_input_destinations_required')
    source = input_provider.extract_input(SOURCE['path'], SOURCE['sha256'], SOURCE['bytes'], 'source', 'source')
    deps = input_provider.extract_input(archive['path'], archive['sha256'], archive['bytes'], 'deps', 'deps')
    _pin(Path(ctx.site) / 'package-lock.json', LOCK_SHA256)
    _pin(root / 'deps/package-lock.json', LOCK_SHA256)
    ctx._runtime_steps_state['source_files'] = _snapshot(ctx, source)
    ctx.source_manifest = source
    ctx.prepare_records = {'source_members': source['members'], 'dependency_members': deps['members'],
                           'source_sha256': SOURCE['sha256'], 'dependencies_sha256': archive['sha256'],
                           'full_cache_integrity_claimed': False}
    _scan_source(ctx)
    (Path(ctx.site) / 'node_modules').symlink_to('../../deps/node_modules', target_is_directory=True)
    _private_build(root)
    lock = _pdf_lock(ctx)
    _public(TOOLS / 'pdfjs/package.tgz', PDFJS_ARCHIVE_SHA256, lock['archiveSize'])
    phase = supervisor.run('prepare-offline-assets', [str(ctx.node), 'scripts/prepare-pdfjs-assets.mjs', '--offline', '--cache-dir', str(TOOLS / 'pdfjs')],
                           cwd='source/site', env=_environment(ctx, 'prepare'), timeout=300,
                           expected_checks=1, observed_checks=lambda: _pdf_ready(ctx))
    _verify_source(ctx)
    ctx._runtime_steps_state['prepared'] = phase['success'] is True
    return phase


def typecheck(ctx, supervisor):
    _context(ctx, supervisor); state = _state(ctx)
    if state.get('prepared') is not True or state.get('typecheck_started'):
        raise RuntimePending('prepared_single_typecheck_required')
    state['typecheck_started'] = True; _verify_source(ctx)
    phase = supervisor.run('typecheck', [str(ctx.node), 'node_modules/typescript/bin/tsc', '--noEmit', '--incremental', 'false'],
                           cwd='source/site', env=_environment(ctx, 'typecheck'), timeout=ctx.resources['runtime_seconds'],
                           expected_checks=1, observed_checks=lambda: _verify_source(ctx))
    _verify_source(ctx); state['typechecked'] = phase['success'] is True
    return phase


def _guard_ready(ctx):
    path = Path(ctx.root) / 'private-build/t/build-guard.jsonl'
    try:
        raw = _read(path, 1024**2)
    except OSError as error:
        raise RuntimePending('actual_build_guard_installation_required') from error
    installed = 0
    for line in raw.splitlines():
        try:
            row = json.loads(line)
        except ValueError as error:
            raise RuntimePending('valid_build_guard_receipt_required') from error
        if row != {'kind': 'installed'}:
            raise RuntimePending('build_network_denial_or_unknown_guard_record')
        installed += 1
    if not 1 <= installed <= 4096:
        raise RuntimePending('actual_build_guard_installation_required')
    if not (Path(ctx.site) / '.next/BUILD_ID').is_file():
        raise RuntimePending('fresh_next_build_id_required')
    _verify_source(ctx)
    return 1


def build(ctx, supervisor):
    _context(ctx, supervisor); state = _state(ctx)
    if state.get('typechecked') is not True or state.get('build_started'):
        raise RuntimePending('successful_typecheck_before_single_build_required')
    state['build_started'] = True; _verify_source(ctx)
    if os.path.lexists(Path(ctx.site) / '.next'):
        raise RuntimePending('fresh_next_build_output_required')
    pin = getattr(ctx, 'qa_inventory', {}).get('qa/build-guard.mjs')
    if type(pin) is not dict or set(pin) != {'sha256', 'bytes'}:
        raise RuntimePending('pinned_new_build_guard_closure_required')
    _public(TOOLS / 'qa/build-guard.mjs', pin['sha256'], pin['bytes'])
    phase = supervisor.run('build', [str(ctx.node), 'node_modules/next/dist/bin/next', 'build'],
                           cwd='source/site', env=_environment(ctx, 'build'), timeout=ctx.resources['runtime_seconds'],
                           expected_checks=1, observed_checks=lambda: _guard_ready(ctx))
    _verify_source(ctx); state['built'] = phase['success'] is True
    return phase


def _production_packages(ctx):
    site = Path(ctx.site); deps = Path(ctx.root) / 'deps'
    _pin(site / 'package-lock.json', LOCK_SHA256); _pin(deps / 'package-lock.json', LOCK_SHA256)
    lock = _json(site / 'package-lock.json')
    packages = lock.get('packages')
    if type(packages) is not dict or not 1 <= len(packages) <= 10000:
        raise RuntimePending('complete_lock_package_inventory_required')
    installed, skipped = [], []
    for name, row in sorted(packages.items()):
        if type(row) is not dict:
            raise RuntimePending('typed_production_package_lock_entry_required')
        if not name or row.get('dev') is True:
            continue
        _safe_name(name)
        if not name.startswith('node_modules/') or type(row) is not dict or type(row.get('version')) is not str:
            raise RuntimePending('exact_production_package_lock_entry_required')
        path = deps / name
        if not os.path.lexists(path):
            def supported(tags, current):
                if type(tags) is not list or len(tags) > 128 or any(type(tag) is not str for tag in tags):
                    raise RuntimePending('typed_optional_platform_constraints_required')
                positive = [tag for tag in tags if not tag.startswith('!')]
                return '!' + current not in tags and (not positive or current in positive)
            platforms, cpus = row.get('os', []), row.get('cpu', [])
            incompatible = not supported(platforms, 'linux') or not supported(cpus, 'x64')
            if row.get('optional') is not True or not incompatible:
                raise RuntimePending('compatible_production_dependency_missing')
            skipped.append(name); continue
        _chain(path)
        if not path.is_dir() or _json(path / 'package.json', 1024**2).get('version') != row['version']:
            raise RuntimePending('production_package_bytes_or_version_mismatch')
        installed.append(name)
    if not {'node_modules/next', 'node_modules/pg'} <= set(installed):
        raise RuntimePending('next_and_pg_production_runtime_required')
    return installed, skipped


def _runtime_inventory(ctx):
    site, deps = Path(ctx.site), Path(ctx.root) / 'deps'
    installed, skipped = _production_packages(ctx)
    files = {}; total = 0
    def add(path, name, allowed):
        nonlocal total
        _safe_name(name)
        if name in files or len(files) >= MAX_FILES:
            raise RuntimePending('unique_bounded_runtime_inventory_required')
        real = path.resolve(strict=True)
        if not real.is_relative_to(allowed) or not real.is_file():
            raise RuntimePending('runtime_dependency_symlink_escape')
        _chain(real)
        raw = _read(real, scan=True)
        total += len(raw)
        if total > MAX_TOTAL:
            raise RuntimePending('runtime_export_byte_budget_exceeded')
        files[name] = {'source': real, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
                       'mode': 0o755 if real.stat().st_mode & 0o111 else 0o644}
    def tree(path, prefix, allowed, excluded=()):
        _chain(path)
        if not path.is_dir():
            raise RuntimePending('required_new_runtime_tree_missing')
        for directory, dirs, names in os.walk(path, followlinks=False):
            parent = Path(directory); rel = parent.relative_to(path)
            for directory_name in list(dirs):
                child = parent / directory_name
                if child.is_symlink():
                    raise RuntimePending('runtime_directory_symlink_requires_review')
                if directory_name in excluded:
                    dirs.remove(directory_name)
            for name in sorted(names):
                if name in excluded:
                    continue
                add(parent / name, (PurePosixPath(prefix) / rel / name).as_posix(), allowed)
    for name in ('package.json', 'package-lock.json', 'next.config.mjs'):
        add(site / name, name, site)
    tree(site / '.next', '.next', site, ('cache', 'types', 'trace'))
    for name in ('public', 'assets'):
        tree(site / name, name, site)
    for name in installed:
        tree(deps / name, name, deps, ('node_modules',))
    try:
        required = _json(site / '.next/required-server-files.json').get('files')
    except OSError as error:
        raise RuntimePending('next_required_server_files_contract_missing') from error
    if type(required) is not list or not 1 <= len(required) <= 4096:
        raise RuntimePending('next_required_server_files_contract_missing')
    for name in required:
        _safe_name(name)
        if name not in files:
            raise RuntimePending('required_next_server_file_omitted')
    for name in ('node_modules/next/dist/bin/next', 'node_modules/pg/lib/index.js', '.next/BUILD_ID'):
        if name not in files:
            raise RuntimePending('required_compiled_entrypoint_missing')
    return files, installed, skipped


def export_runtime(ctx, supervisor):
    root = _context(ctx, supervisor); state = _state(ctx); started = time.monotonic()
    if state.get('built') is not True or state.get('export_started'):
        raise RuntimePending('successful_same_job_build_before_single_export_required')
    state['export_started'] = True; _verify_source(ctx); _guard_ready(ctx)
    if os.path.lexists(ctx.compiled):
        raise RuntimePending('fresh_compiled_destination_required')
    files, installed, skipped = _runtime_inventory(ctx)  # No output until complete.
    compiled = Path(ctx.compiled)
    compiled_fd = input_provider._destination('compiled')
    try:
        for name, row in sorted(files.items()):
            _relative(name)
            raw = _read(row['source'], scan=True)
            if len(raw) != row['bytes'] or hashlib.sha256(raw).hexdigest() != row['sha256']:
                raise RuntimePending('runtime_input_drift_during_export')
            parent, leaf = input_provider._member_parent(compiled_fd, name)
            try:
                fd = os.open(leaf, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, row['mode'], dir_fd=parent)
                with os.fdopen(fd, 'wb') as stream:
                    stream.write(raw); stream.flush(); os.fsync(stream.fileno())
                os.fsync(parent)
            finally:
                os.close(parent)
        os.fsync(compiled_fd)
    finally:
        os.close(compiled_fd)
    _verify_source(ctx)
    for name, row in files.items():
        _pin(compiled / name, row['sha256'], row['bytes'])
    state['exported'] = True
    ctx.runtime_export = {'version': 1, 'source_sha256': SOURCE['sha256'], 'source_stable': True,
                          'runtime_files': len(files), 'runtime_bytes': sum(row['bytes'] for row in files.values()),
                          'production_packages': installed, 'optional_incompatible_skipped': skipped,
                          'files_sha256': hashlib.sha256(_canonical({name: {key: row[key] for key in ('sha256', 'bytes')} for name, row in sorted(files.items())}).encode()).hexdigest(),
                          'compiled_bytes_rewritten': False, 'build_only_markers_embedded': False,
                          'qualified': False, 'cache_integrity_verified': False}
    return {'name': 'export-runtime', 'exit_code': 0, 'signal': None,
            'duration_ms': max(0, int((time.monotonic() - started) * 1000)),
            'expected_checks': len(files), 'observed_checks': len(files), 'success': True}
