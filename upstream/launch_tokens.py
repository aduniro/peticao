"""Private launch-envelope custody. No scheduler, public endpoint or credentials.

Preparation is exclusive and durable before returning a synthetic per-job token.
An existing/incomplete envelope never triggers token regeneration or dispatch.
The existing canonical queue/Claims remains the sole launch authority.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import stat

PROJECT_RUNTIME = Path('/mnt/apps/peticao-final/.runtime')
LIMIT = 4096


class CustodyUncertain(RuntimeError):
    pass


class LaunchSecret:
    __slots__ = ('__value',)

    def __init__(self, value):
        if not isinstance(value, str) or not re.fullmatch('[a-f0-9]{64}', value):
            raise ValueError('fixed_256bit_launch_token_required')
        self.__value = value

    def __repr__(self):
        return '<LaunchSecret redacted>'

    __str__ = __repr__

    def __reduce_ex__(self, _):
        raise TypeError('launch_secret_is_not_serializable')

    def value_for_dispatch(self):
        """Internal Backend.dispatch input only; never argv/log/public RPC."""
        return self.__value

    def sha256(self):
        return hashlib.sha256(self.__value.encode('ascii')).hexdigest()


def reference(manifest):
    if not isinstance(manifest, dict):
        raise ValueError('internal_manifest_object_required')
    job, generation = manifest.get('job_id'), manifest.get('generation')
    if not isinstance(job, str) or not re.fullmatch('[a-f0-9]{32}', job) or type(generation) is not int or generation < 1:
        raise ValueError('fixed_job_generation_required')
    raw = json.dumps(manifest, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()
    if len(raw) > 65536:
        raise ValueError('bounded_internal_manifest_required')
    return {'job_id': job, 'generation': generation, 'manifest_sha256': hashlib.sha256(raw).hexdigest()}


def private_root(path):
    p = Path(path).absolute()
    for parent in [*reversed(p.parents), p]:
        info = parent.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, os.geteuid()} or info.st_mode & 0o022:
            raise PermissionError('trusted_launch_custody_ancestors_required')
    info = p.lstat()
    if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError('owned_private_launch_custody_required')
    return p


def object_no_duplicates(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError('duplicate_envelope_key')
        result[key] = value
    return result


class TokenStore:
    def __init__(self, root, *, validator=private_root, allowed_root=PROJECT_RUNTIME,
                 factory=lambda: secrets.token_hex(32)):
        root, allowed = Path(root).absolute(), Path(allowed_root).absolute()
        if '..' in root.parts or '..' in allowed.parts or root == allowed or allowed not in root.parents:
            raise PermissionError('dedicated_project_launch_custody_required')
        self.root, self.validator, self.factory = root, validator, factory
        self.validator(self.root)
        self.fd = os.open(self.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
        self.closed = False

    def close(self):
        if not self.closed:
            os.close(self.fd); self.closed = True

    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()

    def _check(self):
        if self.closed:
            raise PermissionError('closed_launch_custody')
        self.validator(self.root)
        a, b = self.root.lstat(), os.fstat(self.fd)
        if (a.st_dev, a.st_ino) != (b.st_dev, b.st_ino):
            raise PermissionError('launch_custody_root_replaced')

    def prepare(self, manifest):
        """Called BEFORE queue reserve. Never overwrite/reuse an existing intent."""
        ref = reference(manifest); self._check()
        name = ref['job_id'] + '.json'
        # The empty file itself is the durable preparation intent. A crash here
        # blocks retry and requires explicit reconciliation; no silent new token.
        fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=self.fd)
        with os.fdopen(fd, 'wb') as stream:
            # Only the just-created exclusive file is adjusted, never a prior
            # envelope. A restrictive inherited umask must not strand custody.
            os.fchmod(stream.fileno(), 0o600)
            os.fsync(stream.fileno()); os.fsync(self.fd)
            secret = LaunchSecret(self.factory())
            record = {'version': 1, **ref, 'token': secret.value_for_dispatch()}
            raw = json.dumps(record, sort_keys=True, separators=(',', ':')).encode() + b'\n'
            stream.write(raw); stream.flush(); os.fsync(stream.fileno())
        os.fsync(self.fd)
        self._check()
        if self.load(manifest).sha256() != secret.sha256():
            raise CustodyUncertain('published_launch_envelope_mismatch')
        return secret

    def load(self, manifest):
        """Recover the SAME secret. This method never reserves or launches work."""
        ref = reference(manifest); self._check()
        try:
            fd = os.open(ref['job_id'] + '.json', os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=self.fd)
            with os.fdopen(fd, 'rb') as stream:
                before = os.fstat(stream.fileno())
                if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.geteuid() or before.st_nlink != 1
                        or stat.S_IMODE(before.st_mode) != 0o600 or before.st_size > LIMIT):
                    raise ValueError('private_regular_launch_envelope_required')
                raw = stream.read(LIMIT + 1)
                after = os.fstat(stream.fileno())
                fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns')
                if not raw or len(raw) > LIMIT or len(raw) != before.st_size or any(getattr(before, k) != getattr(after, k) for k in fields):
                    raise ValueError('stable_complete_launch_envelope_required')
                value = json.loads(raw, object_pairs_hook=object_no_duplicates)
                if (not isinstance(value, dict) or set(value) != {'version', 'job_id', 'generation', 'manifest_sha256', 'token'}
                        or type(value['version']) is not int or value['version'] != 1 or type(value['generation']) is not int
                        or any(value[k] != v for k, v in ref.items())):
                    raise ValueError('exact_bound_launch_envelope_required')
                secret = LaunchSecret(value['token'])
                # A previous producer may have died after publishing complete
                # bytes but before syncing them. Visibility is not durability.
                # Linux permits fsync on this read-only regular-file descriptor;
                # any failure remains uncertain and must not yield a launch key.
                os.fsync(stream.fileno())
                os.fsync(self.fd)
            self._check()
            return secret
        except FileNotFoundError:
            raise FileNotFoundError('launch_envelope_absent') from None
        except (ValueError, OSError, UnicodeError, PermissionError):
            # Never echo JSON parser excerpts, pathname/token contents or errors
            # from an untrusted file into the canonical daemon's log.
            raise CustodyUncertain('launch_envelope_uncertain_no_regeneration') from None

    def metadata(self, manifest):
        ref = reference(manifest)
        secret = self.load(manifest)
        return {'state': 'prepared', **ref, 'token_sha256': secret.sha256()}
