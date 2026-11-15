"""Closed UID1000 public-data producer, NOT the runtime Root provider.

No effects on import. No owner parameter, shell, extraction, child execution,
network, install or cleanup. produce() has no arbitrary path/argument channel.
The only group-writable-ancestor exception is the fixed HASHED public ingress;
code and new staging must remain controlled. Failure preserves every partial.
"""
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import types

UID = 1000
SOURCE = Path('/mnt/apps/peticao-final/infra-public-inputs-20261115/producer-source')
POLICY = SOURCE / 'PRODUCER-POLICY.json'
EXEC_POLICY = SOURCE.parent / 'PRODUCER-EXECUTION-POLICY.json'
INGRESS = Path('/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-qualification-20261114/dependencies-node20-pdfjs.public.tar.gz')
STAGING = Path('/mnt/apps/peticao-final/infra-public-inputs-20261115/staging-1')
PARENT_SHA = '3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698'
PARENT_BYTES = 207013889
BASE_COMMIT = '32cce868127cb586cf5d314e429f0c3abbf0b6a5'
BASE = {'input_provider.py': {'sha256': '6e92cc0585365fc45e04344934bb2088a7d92dea57733601b7903453c36b17d4', 'bytes': 18047},
        'normalize_dependencies.py': {'sha256': 'a940d266afabedd96ac22efa011fb54849a805f1fd6838d4d2a8e7963038f31c', 'bytes': 16155}}
NAMES = frozenset({'PRODUCER-INTENT.json', 'parent.input.tar.gz', 'dependencies.normalized.tar.gz', 'NORMALIZATION-RECEIPT.json'})
BUFFER = 1048576


class ProducerRejected(ValueError):
    pass


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def role():
    if os.getuid() != UID or os.geteuid() != UID:
        raise PermissionError('explicit_offline_uid1000_role_required')


def signature(info):
    return (info.st_dev, info.st_ino, info.st_mode, info.st_uid, info.st_gid,
            info.st_nlink, info.st_size, info.st_mtime_ns, info.st_ctime_ns)


def _path(path):
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts or path != Path(os.path.normpath(path)):
        raise ProducerRejected('fixed_canonical_absolute_path_required')
    return path


def _directory(info, public_data=False):
    if not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, UID}:
        raise PermissionError('offline_owned_directory_required')
    if not public_data and info.st_mode & 0o022:
        raise PermissionError('controlled_code_and_staging_ancestors_required')


def _walk(path, public_data=False):
    path = _path(path)
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        _directory(os.fstat(fd), public_data)
        for name in path.parts[1:]:
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
            _directory(os.fstat(fd), public_data)
        return fd
    except BaseException:
        os.close(fd)
        raise


def _regular(info, private=False):
    if (not stat.S_ISREG(info.st_mode) or info.st_uid != UID or info.st_nlink != 1
            or info.st_mode & 0o022 or (private and stat.S_IMODE(info.st_mode) != 0o600)):
        raise PermissionError('offline_uid1000_regular_single_link_file_required')


class HeldDirectory:
    def __init__(self, path):
        role()
        self.path = _path(path)
        self.fd = _walk(self.path)
        try:
            self.identity = os.fstat(self.fd)
            if self.identity.st_uid != UID or stat.S_IMODE(self.identity.st_mode) != 0o700:
                raise PermissionError('owned_private_offline_directory_required')
        except BaseException:
            os.close(self.fd); self.fd = -1
            raise

    def check(self):
        if self.fd < 0:
            raise PermissionError('closed_offline_directory')
        current = _walk(self.path)
        try:
            a, b = os.fstat(self.fd), os.fstat(current)
            if (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino) or a.st_uid != UID or stat.S_IMODE(a.st_mode) != 0o700:
                raise PermissionError('offline_output_directory_alias_replaced')
        finally:
            os.close(current)

    def close(self):
        if self.fd >= 0:
            os.close(self.fd); self.fd = -1

    def __enter__(self):
        self.check(); return self

    def __exit__(self, *_):
        try:
            self.check()
        finally:
            self.close()


def new_staging(path):
    """Private helper also used by fictitious tests; operational path is fixed."""
    role(); path = _path(path)
    parent = _walk(path.parent)
    try:
        before = os.fstat(parent)
        os.mkdir(path.name, 0o700, dir_fd=parent)  # Exclusive; never reuse/chmod old.
        new = os.stat(path.name, dir_fd=parent, follow_symlinks=False)
        if not stat.S_ISDIR(new.st_mode) or new.st_uid != UID or stat.S_IMODE(new.st_mode) != 0o700:
            raise PermissionError('new_staging_must_be_uid1000_mode700')
        os.fsync(parent)
        current = _walk(path.parent)
        try:
            now = os.fstat(current)
            if (before.st_dev, before.st_ino) != (now.st_dev, now.st_ino):
                raise PermissionError('staging_parent_replaced')
        finally:
            os.close(current)
    finally:
        os.close(parent)
    return HeldDirectory(path)


def exclusive(stage, name):
    if name not in NAMES:
        raise ProducerRejected('fixed_offline_output_name_required')
    stage.check()
    fd = os.open(name, os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=stage.fd)
    try:
        os.fchmod(fd, 0o600)  # This exclusive new file only; never original/cache.
        _regular(os.fstat(fd), private=True)
        os.fsync(fd); os.fsync(stage.fd)
        return os.fdopen(fd, 'w+b')
    except BaseException:
        os.close(fd)
        raise


def assert_file(fp, stage, name, expected):
    stage.check()
    observed = os.fstat(fp.fileno())
    named = os.stat(name, dir_fd=stage.fd, follow_symlinks=False)
    _regular(observed, private=True)
    if signature(observed) != expected or signature(named) != expected:
        raise ProducerRejected('held_offline_file_changed_or_replaced')


def _hash(fp, maximum):
    fp.seek(0); digest = hashlib.sha256(); size = 0
    while block := fp.read(min(BUFFER, maximum + 1 - size)):
        size += len(block)
        if size > maximum:
            raise ProducerRejected('bounded_offline_file_required')
        digest.update(block)
    fp.seek(0)
    return digest.hexdigest(), size


@contextlib.contextmanager
def verified_public_input(path, sha, size):
    """Pinned DATA exception: writable ancestors confer zero code authority."""
    role(); path = _path(path)
    if type(sha) is not str or not re.fullmatch('[a-f0-9]{64}', sha) or type(size) is not int or not 0 < size <= 2**32:
        raise ProducerRejected('exact_public_input_pin_required')
    parent = _walk(path.parent, public_data=True)
    try:
        parent_identity = os.fstat(parent)
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno()); _regular(before)
            if before.st_size != size or signature(os.stat(path.name, dir_fd=parent, follow_symlinks=False)) != signature(before):
                raise ProducerRejected('public_input_identity_or_size_mismatch')
            if _hash(stream, size) != (sha, size):
                raise ProducerRejected('public_input_hash_mismatch')
            try:
                yield stream
            finally:
                current = _walk(path.parent, public_data=True)
                try:
                    now = os.fstat(current)
                    if ((now.st_dev, now.st_ino) != (parent_identity.st_dev, parent_identity.st_ino)
                            or signature(os.fstat(stream.fileno())) != signature(before)
                            or signature(os.stat(path.name, dir_fd=parent, follow_symlinks=False)) != signature(before)):
                        raise ProducerRejected('public_input_changed_during_consumption')
                finally:
                    os.close(current)
    finally:
        os.close(parent)


def copy_to_stage(original, stage, sha, size):
    copied = exclusive(stage, 'parent.input.tar.gz')
    try:
        original.seek(0); digest = hashlib.sha256(); count = 0
        while block := original.read(min(BUFFER, size + 1 - count)):
            count += len(block)
            if count > size:
                raise ProducerRejected('public_input_grew_during_copy')
            copied.write(block); digest.update(block)
        copied.flush(); os.fsync(copied.fileno()); os.fsync(stage.fd)
        if (digest.hexdigest(), count) != (sha, size) or _hash(copied, size) != (sha, size):
            raise ProducerRejected('public_copy_hash_or_size_mismatch')
        expected = signature(os.fstat(copied.fileno()))
        assert_file(copied, stage, 'parent.input.tar.gz', expected)
        return copied, expected
    except BaseException:
        copied.close()  # Preserve exclusive partial, never delete/retry.
        raise


def code_bytes(path, expected=None):
    path = _path(path); parent = _walk(path.parent)
    try:
        fd = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as stream:
            before = os.fstat(stream.fileno()); _regular(before)
            if before.st_size > 4 * BUFFER:
                raise ProducerRejected('bounded_offline_tcb_required')
            raw = stream.read(4 * BUFFER + 1)
            if len(raw) != before.st_size or signature(os.fstat(stream.fileno())) != signature(before) or signature(os.stat(path.name, dir_fd=parent, follow_symlinks=False)) != signature(before):
                raise ProducerRejected('offline_tcb_changed_while_reading')
            row = {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)}
            if expected is not None and row != expected:
                raise PermissionError('frozen_offline_code_hash_mismatch')
            return raw, row
    finally:
        os.close(parent)


def _unique_json(rows):
    value = {}
    for key, item in rows:
        if key in value:
            raise ProducerRejected('duplicate_offline_policy_key')
        value[key] = item
    return value


def _no_nonfinite(_):
    raise ProducerRejected('nonfinite_offline_policy_value')


def _parse_json(raw):
    return json.loads(raw, object_pairs_hook=_unique_json, parse_constant=_no_nonfinite)


def _validate_policy(value, live):
    keys = {'version', 'role', 'uid', 'execute', 'base_commit', 'source_files', 'ingress', 'staging', 'qualified', 'root_install_performed'}
    if (type(value) is not dict or set(value) != keys or type(value['version']) is not int or value['version'] != 1
            or value['role'] != 'offline-public-dependency-producer' or type(value['uid']) is not int or value['uid'] != UID
            or type(value['execute']) is not bool or value['base_commit'] != BASE_COMMIT
            or value['ingress'] != {'path': str(INGRESS), 'sha256': PARENT_SHA, 'bytes': PARENT_BYTES}
            or value['staging'] != str(STAGING) or value['qualified'] is not False or value['root_install_performed'] is not False
            or type(value['source_files']) is not dict or set(value['source_files']) != {'offline_normalize.py', *BASE}):
        raise ProducerRejected('exact_closed_offline_producer_policy_required')
    for name, row in BASE.items():
        if value['source_files'][name] != row:
            raise ProducerRejected('frozen_v2_base_identity_required')
    if not live and value['execute'] is not False:
        raise PermissionError('committed_template_must_never_enable_execution')


def _read_policy(template, execution):
    # lexists includes broken links: ANY present invalid live entry must reject,
    # never silently fall back to the committed non-executing template.
    live = os.path.lexists(execution)
    selected = execution if live else template
    raw, row = code_bytes(selected)
    value = _parse_json(raw)
    _validate_policy(value, live)
    source = {name: code_bytes(SOURCE / name, pin)[0] for name, pin in value['source_files'].items()}
    return value, source, row['sha256'], live


def _require_execution(value, live):
    if not live or value['execute'] is not True:
        raise PermissionError('offline_producer_execution_not_released')


def load_policy(require_execute=False):
    role()
    if Path(__file__).absolute() != SOURCE / 'offline_normalize.py':
        raise PermissionError('fixed_offline_producer_source_required')
    with HeldDirectory(SOURCE):
        value, source, policy_sha, live = _read_policy(POLICY, EXEC_POLICY)
        if require_execute:
            _require_execution(value, live)
        return value, source, policy_sha


def load_base(source):
    """Compile only the verified copied bytes, never reopen/import from _ops."""
    for name in ('input_provider', 'normalize_dependencies'):
        cached = sys.modules.get(name)
        if cached is not None and (getattr(cached, '__file__', None) != str(SOURCE / (name + '.py'))
                                   or getattr(cached, '_offline_source_sha256', None) != BASE[name + '.py']['sha256']):
            raise PermissionError('foreign_preloaded_provider_refused_no_overwrite')
    result = {}
    for name in ('input_provider', 'normalize_dependencies'):
        module = sys.modules.get(name)
        if module is None:
            raw = source[name + '.py']
            if hashlib.sha256(raw).hexdigest() != BASE[name + '.py']['sha256']:
                raise PermissionError('exact_frozen_bytes_required_before_compile')
            module = types.ModuleType(name)
            module.__file__ = str(SOURCE / (name + '.py'))
            module._offline_source_sha256 = BASE[name + '.py']['sha256']
            sys.modules[name] = module  # New own module only, never replace Root.
            try:
                exec(compile(raw, module.__file__, 'exec'), module.__dict__)
            except BaseException:
                del sys.modules[name]
                raise
        result[name] = module
    return result['normalize_dependencies']


def _write_json(stage, name, value):
    raw = (canonical(value) + '\n').encode()
    if len(raw) > 32 * BUFFER:
        raise ProducerRejected('bounded_offline_receipt_required')
    with exclusive(stage, name) as stream:
        stream.write(raw); stream.flush(); os.fsync(stream.fileno())
    os.fsync(stage.fd); stage.check()


def normalize_copy(copy_fp, copy_signature, stage, normalizer):
    """Frozen V2 algorithm on the SAME verified staged FD; no extraction."""
    assert_file(copy_fp, stage, 'parent.input.tar.gz', copy_signature)
    inventory = normalizer._inventory(copy_fp)
    output = exclusive(stage, 'dependencies.normalized.tar.gz')
    try:
        normalizer._produce(copy_fp, output, inventory)
        strict = normalizer._validate_output(output, inventory)
        size = os.fstat(output.fileno()).st_size
        output_sha, measured = _hash(output, size)
        if measured != size:
            raise ProducerRejected('normalized_output_size_changed')
        output_signature = signature(os.fstat(output.fileno()))
        assert_file(output, stage, 'dependencies.normalized.tar.gz', output_signature)
        assert_file(copy_fp, stage, 'parent.input.tar.gz', copy_signature)
        return inventory, strict, output_sha, size, output_signature, output
    except BaseException:
        output.close()
        raise


def produce():
    if not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:
        raise PermissionError('isolated_no_site_no_bytecode_producer_required')
    value, source, policy_sha = load_policy(require_execute=True)
    normalizer = load_base(source)
    with new_staging(STAGING) as stage:
        _write_json(stage, 'PRODUCER-INTENT.json', {'version': 1, 'uid': UID, 'policy_sha256': policy_sha, 'no_replay': True})
        copied = output = None
        try:
            with verified_public_input(INGRESS, PARENT_SHA, PARENT_BYTES) as original:
                copied, copy_signature = copy_to_stage(original, stage, PARENT_SHA, PARENT_BYTES)
                inventory, strict, output_sha, size, output_signature, output = normalize_copy(copied, copy_signature, stage, normalizer)
            # The original verified-FD context MUST exit before any receipt.
            assert_file(copied, stage, 'parent.input.tar.gz', copy_signature)
            if signature(os.stat('dependencies.normalized.tar.gz', dir_fd=stage.fd, follow_symlinks=False)) != output_signature:
                raise ProducerRejected('normalized_named_output_replaced_before_receipt')
            current, _, current_policy_sha = load_policy(require_execute=True)
            if current != value or current_policy_sha != policy_sha:
                raise ProducerRejected('producer_policy_changed_during_normalization')
            assert_file(output, stage, 'dependencies.normalized.tar.gz', output_signature)
            record = {'version': 1, 'state': 'OFFLINE_NORMALIZED_ARCHIVE_VERIFIED', 'role': value['role'], 'uid': UID,
                      'base_commit': BASE_COMMIT, 'source_files': value['source_files'], 'policy_sha256': policy_sha,
                      'parent_sha256': PARENT_SHA, 'parent_bytes': PARENT_BYTES, 'parent_preserved': True,
                      'staged_copy_sha256': PARENT_SHA, 'staged_copy_bytes': PARENT_BYTES,
                      'output_sha256': output_sha, 'output_bytes': size, 'qualified': False,
                      'cache_integrity_verified': False, 'root_install_performed': False,
                      'normalization': {'only_hardlink_materialized': normalizer.HARDLINK_PATH,
                                        'regular_target': normalizer.HARDLINK_TARGET,
                                        'symlink_count': len(inventory['symlinks']), 'symlinks_preserved': inventory['symlinks'],
                                        'uid': 0, 'gid': 0, 'mtime': 0, 'gzip_mtime': 0, 'gzip_filename': ''},
                      'entrymap': inventory['entries'],
                      'strict_manifest': {key: strict[key] for key in ('version', 'kind', 'members', 'unpacked_bytes', 'qualified', 'cache_integrity_verified')}}
            _write_json(stage, 'NORMALIZATION-RECEIPT.json', record)
            return {key: record[key] for key in ('state', 'output_sha256', 'output_bytes', 'qualified', 'root_install_performed')}
        finally:
            if output is not None:
                output.close()
            if copied is not None:
                copied.close()


def main():
    if len(sys.argv) != 1:
        raise ProducerRejected('closed_offline_producer_accepts_no_arguments')
    os.umask(0o077)
    print(canonical(produce()))


if __name__ == '__main__':
    try:
        main()
    except BaseException as error:
        print(canonical({'state': 'OFFLINE_PRODUCER_UNCERTAIN_NO_REPLAY', 'error_type': type(error).__name__, 'qualified': False}))
        raise SystemExit(1)
