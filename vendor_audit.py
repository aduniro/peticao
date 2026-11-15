"""Pinned DATA-only NPM file audit. No extraction, install, scripts or imports.

Network API is disabled by default and requires separate coordinator approval.
Neither a matching comparison nor an SRI ever sets fullVendorIntegrity true.
"""
from contextlib import contextmanager
import base64
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import re
import stat
import tarfile
import time
import urllib.parse
import urllib.request

PUBLIC_ROOT = Path('/mnt/apps/peticao-final/infra-public-inputs-20261115')
DEFAULT_DOWNLOAD_ROOT = PUBLIC_ROOT / 'vendor-tarballs'
STAGING_UID = 1000
LOCK_SHA256 = '52963634411e4f0dcdb829d53a5c51d98eba853f87227930fae4a1c87f0abe74'
INPUTS = {
    'source': ('/mnt/apps/peticao-final/_ops/admin-v2-query-r1-20261114/retry-1/source-r1.tar.gz',
               '19db95b7c0628dac9fbcec961adbdf3a01bfa00b1519f28a376427e80707a4d5', 11959902),
    'deps': ('/mnt/apps/peticao-final/_ops/infra-coordenacao-20261112/distributed/civo-qualification-20261114/dependencies-node20-pdfjs.public.tar.gz',
             '3009712141b019777b6395e36a628f4e1c0b8720fb617e4ffe5c814d91670698', 207013889),
}
MAX_DOWNLOAD = 64 * 1024**2
MAX_TOTAL_DOWNLOAD = 512 * 1024**2
MAX_DOWNLOAD_SECONDS = 60
MAX_FILE = 256 * 1024**2
MAX_UNPACKED = 2 * 1024**3
MAX_MEMBERS = 30000
MAX_JSON = 4 * 1024**2
MAX_METADATA = 32 * 1024**2
CHUNK = 65536


class AuditRejected(ValueError):
    pass


def _require(condition, code):
    if not condition:
        raise AuditRejected(code)


def _name(name):
    _require(type(name) is str and 0 < len(name.encode()) <= 1024 and '\\' not in name
        and not any(ord(c) < 32 or ord(c) == 127 for c in name), 'bounded_canonical_member_required')
    p = PurePosixPath(name)
    _require(not p.is_absolute() and str(p) == name and len(p.parts) <= 128
        and not any(x in ('', '.', '..') for x in name.split('/')), 'member_traversal_or_alias')
    return p.parts


class BoundedTarInfo(tarfile.TarInfo):
    """Approved bounded-header algorithm, copied without operational guards."""
    def _proc_member(self, archive):
        archive._audit_headers = getattr(archive, '_audit_headers', 0) + 1
        _require(archive._audit_headers <= 3 * MAX_MEMBERS, 'hidden_header_count_exceeded')
        extensions = {tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE,
                      tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK}
        if self.type in extensions:
            archive._audit_metadata = getattr(archive, '_audit_metadata', 0) + self.size
            _require(archive._audit_metadata <= 8 * 1024**2, 'hidden_metadata_budget_exceeded')
        if self.type in {tarfile.XHDTYPE, tarfile.XGLTYPE, tarfile.SOLARIS_XHDTYPE}:
            _require(self.size <= 65536, 'pax_header_too_large')
        if self.type in {tarfile.GNUTYPE_LONGNAME, tarfile.GNUTYPE_LONGLINK}:
            _require(self.size <= 1025, 'long_header_too_large')
        _require(self.type != tarfile.GNUTYPE_SPARSE and 0 <= self.size <= MAX_FILE, 'sparse_or_oversized_member')
        return super()._proc_member(archive)

    def _proc_pax(self, archive):
        pos = archive.fileobj.tell()
        raw = archive.fileobj.read(self._block(self.size)); archive.fileobj.seek(pos)
        _require(not any(x in raw for x in (b'GNU.sparse', b'SCHILY.realsize', b'SCHILY.filetype=sparse')), 'sparse_pax_forbidden')
        return super()._proc_pax(archive)


def _json(raw):
    _require(len(raw) <= MAX_JSON, 'json_budget_exceeded')
    def pairs(rows):
        result = {}
        for key, value in rows:
            _require(key not in result, 'duplicate_json_key')
            result[key] = value
        return result
    def nonfinite(_):
        raise AuditRejected('nonfinite_json')
    return json.loads(raw, object_pairs_hook=pairs, parse_constant=nonfinite)


def _signature(info):
    return tuple(getattr(info, key) for key in ('st_dev', 'st_ino', 'st_uid', 'st_gid', 'st_mode',
                 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns'))


def _parent(path):
    _require(type(path) is str and path.startswith('/') and str(PurePosixPath(path)) == path
             and '..' not in PurePosixPath(path).parts, 'canonical_absolute_data_path_required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in PurePosixPath(path).parts[1:-1]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
        return fd
    except BaseException:
        os.close(fd)
        raise


def _hash(fp):
    fp.seek(0); h = hashlib.sha256()
    for block in iter(lambda: fp.read(CHUNK), b''):
        h.update(block)
    return h.hexdigest()


@contextmanager
def _pinned_data(path, sha, size):
    """DADO: no Root ownership guard, no substituted fixture/operational guard."""
    parent = _parent(path)
    try:
        fd = os.open(PurePosixPath(path).name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=parent)
        with os.fdopen(fd, 'rb') as fp:
            before = os.fstat(fp.fileno())
            _require(stat.S_ISREG(before.st_mode) and before.st_nlink == 1 and before.st_size == size,
                     'exact_regular_data_input_required')
            _require(_hash(fp) == sha, 'pinned_input_sha_mismatch')
            fp.seek(0)
            yield fp
            _require(_hash(fp) == sha, 'pinned_input_changed_after_parse')
            after = os.fstat(fp.fileno())
            named = os.stat(PurePosixPath(path).name, dir_fd=parent, follow_symlinks=False)
            _require(_signature(before) == _signature(after) == _signature(named), 'pinned_input_stat_changed')
    finally:
        os.close(parent)


def package_root(name):
    parts = _name(name)
    i = 0
    while i < len(parts):
        if parts[i] != 'node_modules':
            return False
        i += 1
        if i >= len(parts):
            return False
        i += 2 if parts[i].startswith('@') else 1
    return i == len(parts)


def _link(name, target, prefix):
    _require(type(target) is str and target and not target.startswith('/') and '\\' not in target
             and len(target.encode()) <= 1024 and not any(ord(c) < 32 for c in target), 'bounded_relative_link_required')
    parts = list(PurePosixPath(name).parent.parts)
    for bit in target.split('/'):
        if bit in ('', '.'):
            continue
        if bit == '..':
            _require(bool(parts), 'link_escapes_archive'); parts.pop()
        else:
            parts.append(bit)
    result = '/'.join(parts)
    _require(result == prefix or result.startswith(prefix + '/'), 'link_escapes_archive')
    _name(result)
    return result


def _inventory(fp, kind):
    fp.seek(0); entries = {}; manifests = {}; lock = None; lock_sha = None
    members = 0; total = 0; metadata = 0
    member_limit = 10000 if kind == 'source' else MAX_MEMBERS
    unpacked_limit = 128 * 1024**2 if kind == 'source' else MAX_UNPACKED
    with tarfile.open(fileobj=fp, mode='r:*', tarinfo=BoundedTarInfo) as archive:
        for member in archive:
            members += 1
            _require(members <= member_limit, 'member_budget_exceeded')
            _name(member.name)
            _require(member.name not in entries and not member.issparse() and 0 <= member.size <= MAX_FILE and not member.mode & 0o7000,
                     'duplicate_sparse_or_oversized_member')
            total += member.size
            _require(total <= unpacked_limit, 'unpacked_budget_exceeded')
            if kind == 'vendor':
                _require(member.name == 'package' or member.name.startswith('package/'), 'fixed_package_prefix_required')
            elif kind == 'deps':
                _require(member.name == 'node_modules' or member.name.startswith('node_modules/')
                    or member.name in {'node', 'package-lock.json', 'package.tgz'}, 'fixed_dependency_prefix_required')
            item = {'kind': 'directory'}
            if member.isdir():
                _require(member.size == 0, 'directory_payload_forbidden')
            elif member.isfile():
                h = hashlib.sha256(); length = 0; first = b''; kept = bytearray()
                is_lock = member.name == ('site/package-lock.json' if kind == 'source' else 'package-lock.json')
                is_manifest = kind == 'deps' and member.name.endswith('/package.json') and package_root(member.name[:-13])
                with archive.extractfile(member) as stream:
                    for block in iter(lambda: stream.read(CHUNK), b''):
                        length += len(block); _require(length <= member.size, 'member_grew')
                        h.update(block)
                        if not first: first = block[:4]
                        if is_lock or is_manifest:
                            kept.extend(block); _require(len(kept) <= MAX_JSON, 'metadata_file_budget_exceeded')
                _require(length == member.size, 'member_truncated')
                item = {'kind': 'file', 'sha256': h.hexdigest(), 'bytes': length,
                        'elf': first == b'\x7fELF', 'executable': bool(member.mode & 0o111)}
                if is_lock or is_manifest:
                    metadata += len(kept); _require(metadata <= MAX_METADATA, 'metadata_total_budget_exceeded')
                    parsed = _json(kept); _require(type(parsed) is dict, 'metadata_object_required')
                    if is_lock: lock = parsed; lock_sha = h.hexdigest()
                    else: manifests[member.name[:-13]] = parsed
            elif member.issym():
                _require(member.size == 0, 'link_payload_forbidden')
                item = {'kind': 'symlink', 'target': _link(member.name, member.linkname, 'package' if kind == 'vendor' else 'node_modules')}
            elif member.islnk():
                _require(member.size == 0, 'link_payload_forbidden')
                _name(member.linkname)
                item = {'kind': 'hardlink', 'target': member.linkname}
            else:
                raise AuditRejected('special_member_forbidden')
            entries[member.name] = item
    # Logical archive alias only; NEVER follow/create filesystem hardlinks.
    for name, row in list(entries.items()):
        if row['kind'] != 'hardlink': continue
        current = row; seen = {name}
        for _ in range(40):
            target = current['target']; _require(target not in seen, 'hardlink_loop')
            seen.add(target); _require(target in entries, 'hardlink_target_missing')
            current = entries[target]
            if current['kind'] != 'hardlink': break
        _require(current['kind'] == 'file', 'regular_hardlink_target_required')
        entries[name] = {**current, 'archive_hardlink_target': row['target']}
    return {'entries': entries, 'manifests': manifests, 'lock': lock, 'lock_sha256': lock_sha,
            'members': members, 'unpacked_bytes': total}


def inspect_fixed_inputs():
    data = {}; receipts = {}
    for kind, (path, sha, size) in INPUTS.items():
        with _pinned_data(path, sha, size) as fp:
            data[kind] = _inventory(fp, kind)
        receipts[kind] = {'path': path, 'sha256': sha, 'bytes': size, 'same_fd_before_after': True,
                          'members': data[kind]['members'], 'unpacked_bytes': data[kind]['unpacked_bytes']}
        _require(data[kind]['lock_sha256'] == LOCK_SHA256, 'approved_lock_sha_mismatch')
    _require(data['source']['lock'] == data['deps']['lock'], 'source_dependency_lock_mismatch')
    roots = sorted(data['deps']['manifests'])
    return {'inputs': receipts, 'lock': data['deps']['lock'], 'installed': data['deps']['entries'],
            'package_roots': roots}


def validate_url(url):
    _require(type(url) is str and len(url) <= 2048 and not any(ord(c) <= 32 or ord(c) == 127 for c in url), 'fixed_registry_https_url_required')
    parsed = urllib.parse.urlsplit(url)
    _require(parsed.scheme == 'https' and parsed.netloc == 'registry.npmjs.org'
             and not parsed.query and not parsed.fragment and parsed.path.endswith('.tgz'), 'fixed_registry_https_url_required')
    decoded = urllib.parse.unquote(parsed.path)
    _require(decoded.startswith('/') and '\\' not in decoded and not any(ord(c) < 32 or ord(c) == 127 for c in decoded)
             and not any(x in ('.', '..', '') for x in decoded[1:].split('/')),
             'canonical_registry_tar_path_required')
    return url


def parse_integrity(value):
    _require(type(value) is str and re.fullmatch(r'sha512-[A-Za-z0-9+/]{86}==', value) is not None,
             'single_canonical_sha512_integrity_required')
    encoded = value[7:]
    raw = base64.b64decode(encoded, validate=True)
    _require(len(raw) == 64 and base64.b64encode(raw).decode() == encoded, 'canonical_sha512_base64_required')
    return raw


def plan_packages(snapshot):
    packages = snapshot['lock'].get('packages')
    _require(type(packages) is dict, 'lock_packages_required')
    result = {}; gaps = []
    for root in snapshot['package_roots']:
        _require(package_root(root), 'installed_package_boundary_required')
        row = packages.get(root)
        try:
            _require(type(row) is dict, 'installed_package_missing_from_lock')
            validate_url(row.get('resolved')); parse_integrity(row.get('integrity'))
            result[root] = {'resolved': row['resolved'], 'integrity': row['integrity']}
        except (ValueError, TypeError):
            gaps.append({'package': root, 'status': 'missing_or_invalid_official_registry_sri_metadata'})
    return result, gaps


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, newurl):
        return None


def _transport(url):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), _NoRedirect())
    return opener.open(urllib.request.Request(url, headers={'User-Agent': 'PinnedVendorDataAudit/1',
                       'Accept': 'application/octet-stream', 'Accept-Encoding': 'identity'}), timeout=20)


def _download_dir(root):
    _require(os.geteuid() == STAGING_UID, 'offline_staging_uid_1000_required')
    path = str(root)
    _require(path.startswith(str(PUBLIC_ROOT) + '/'), 'project_staging_only')
    parent = _parent(path)
    try:
        try: os.mkdir(PurePosixPath(path).name, 0o700, dir_fd=parent)
        except FileExistsError: pass
        fd = os.open(PurePosixPath(path).name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        info = os.fstat(fd)
        if info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
            os.close(fd); raise AuditRejected('owned_private_download_directory_required')
        os.fsync(parent)
        return parent, fd, info
    except BaseException:
        os.close(parent); raise


def _existing_download_bytes(directory):
    total = 0; count = 0
    with os.scandir(directory) as entries:
        for entry in entries:
            count += 1
            _require(count <= 200 and re.fullmatch(r'[a-f0-9]{64}\.tgz', entry.name) is not None,
                     'dedicated_bounded_tarball_staging_required')
            info = os.stat(entry.name, dir_fd=directory, follow_symlinks=False)
            _require(stat.S_ISREG(info.st_mode) and info.st_uid == os.geteuid() and info.st_nlink == 1
                     and stat.S_IMODE(info.st_mode) == 0o600 and 0 <= info.st_size <= MAX_DOWNLOAD,
                     'private_regular_tarball_staging_required')
            total += info.st_size
    _require(total < MAX_TOTAL_DOWNLOAD, 'aggregate_tarball_budget_exhausted')
    return total


def download_tarball(root, package, row, transport=None):
    _require(package_root(package), 'installed_package_boundary_required')
    url = validate_url(row['resolved']); expected = parse_integrity(row['integrity'])
    filename = hashlib.sha256((package + '\n' + url + '\n' + row['integrity']).encode()).hexdigest() + '.tgz'
    parent, directory, before = _download_dir(root)
    fd = -1
    try:
        limit = min(MAX_DOWNLOAD, MAX_TOTAL_DOWNLOAD - _existing_download_bytes(directory))
        fd = os.open(filename, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=directory)
        os.fchmod(fd, 0o600); os.fsync(directory)
        h512 = hashlib.sha512(); h256 = hashlib.sha256(); count = 0
        started = time.monotonic()
        with (transport or _transport)(url) as response:
            _require(response.status == 200 and response.geturl() == url, 'redirect_or_status_refused')
            length = response.headers.get('Content-Length')
            if length is not None:
                _require(type(length) is str and length.isdigit() and int(length) <= limit, 'download_declared_size_bound')
            while block := response.read(CHUNK):
                _require(time.monotonic() - started <= MAX_DOWNLOAD_SECONDS, 'download_deadline_exceeded')
                _require(type(block) is bytes and len(block) <= CHUNK, 'bounded_transport_chunk_required')
                count += len(block); _require(count <= limit, 'download_size_bound')
                h512.update(block); h256.update(block)
                view = memoryview(block)
                while view:
                    written = os.write(fd, view); _require(written > 0, 'short_download_write'); view = view[written:]
            _require(time.monotonic() - started <= MAX_DOWNLOAD_SECONDS, 'download_deadline_exceeded')
            _require(count > 0 and (length is None or count == int(length)), 'download_length_mismatch')
        os.fsync(fd); os.fsync(directory)
        _require(h512.digest() == expected, 'tarball_sri_mismatch_preserve_unapproved')
        opened = os.fstat(fd); named = os.stat(filename, dir_fd=directory, follow_symlinks=False)
        _require(_signature(opened) == _signature(named) and opened.st_nlink == 1 and opened.st_size == count,
                 'download_file_replaced_preserve_partial')
        current = os.stat(PurePosixPath(str(root)).name, dir_fd=parent, follow_symlinks=False)
        _require((before.st_dev, before.st_ino) == (current.st_dev, current.st_ino), 'download_directory_replaced')
        return {'filename': filename, 'bytes': count, 'sha256': h256.hexdigest(), 'sri_verified': True}
    finally:
        try:
            if fd >= 0:
                # Also retain failed/partial bytes for review; never auto-retry.
                try: os.fsync(fd); os.fsync(directory)
                finally: os.close(fd)
        finally:
            os.close(directory); os.close(parent)


def inspect_vendor_tar(fp):
    value = _inventory(fp, 'vendor')
    return {name[len('package/'):]: row for name, row in value['entries'].items()
            if name != 'package' and row['kind'] != 'directory'}


def _owner(path, roots):
    candidates = [root for root in roots if path.startswith(root + '/')]
    return max(candidates, key=len) if candidates else None


def compare_package(root, installed, vendor, all_roots):
    actual = {name[len(root) + 1:]: row for name, row in installed.items()
              if row['kind'] != 'directory' and _owner(name, all_roots) == root}
    expected = {name: row for name, row in vendor.items() if _owner(root + '/' + name, all_roots) == root}
    missing = sorted(set(expected) - set(actual)); extra = sorted(set(actual) - set(expected))
    differences = []; postinstall = []; links = []
    for name in sorted(set(expected) & set(actual)):
        a = actual[name]; v = expected[name]
        if a['kind'] != 'file' or v['kind'] != 'file':
            links.append(name)
            if a['kind'] != v['kind'] or a.get('target') != v.get('target'):
                differences.append({'file': name, 'kind': 'type_or_link_difference'})
        elif (a['sha256'], a['bytes'], a['executable']) != (v['sha256'], v['bytes'], v['executable']):
            candidate = root.endswith('/esbuild') and name == 'bin/esbuild' and a['elf'] and not v['elf']
            differences.append({'file': name, 'kind': 'file_content_or_executable_mode_difference'})
            if candidate: postinstall.append({'file': name, 'classification': 'esbuild_elf_vs_stub_candidate_unapproved'})
    gaps = bool(missing or extra or differences or links)
    return {'package': root, 'status': 'gaps_require_root_review' if gaps else 'file_comparison_matches_only',
        'installed_files': len(actual), 'vendor_files': len(expected), 'missing': missing, 'extra': extra,
        'differences': differences, 'link_metadata_requires_review': links,
        'postinstall_candidates_unapproved': postinstall,
        'delegated_nested_package_files': len(vendor) - len(expected),
        'fullVendorIntegrity': False, 'root_review_required': True}


def run_vendor_audit(snapshot, root=DEFAULT_DOWNLOAD_ROOT, *, allow_public_download=False, transport=None):
    _require(type(allow_public_download) is bool and allow_public_download, 'public_download_not_authorized')
    plans, gaps = plan_packages(snapshot); rows = []
    for package, plan in sorted(plans.items()):
        try:
            receipt = download_tarball(root, package, plan, transport)
            # Reopen only DATA through hash+same-fd verification, never import.
            with _pinned_data(str(Path(root) / receipt['filename']), receipt['sha256'], receipt['bytes']) as fp:
                vendor = inspect_vendor_tar(fp)
            result = compare_package(package, snapshot['installed'], vendor, snapshot['package_roots'])
            result['tarball'] = receipt; rows.append(result)
        except Exception as error:
            rows.append({'package': package, 'status': 'audit_refused_preserve_partial',
                         'safe_error_type': type(error).__name__,
                         'safe_error_code': str(error) if isinstance(error, AuditRejected) else
                            'exclusive_file_already_exists' if isinstance(error, FileExistsError) else 'transport_or_parser_failure',
                         'root_review_required': True})
    unowned = sorted(name for name, row in snapshot['installed'].items() if name.startswith('node_modules/')
                      and row['kind'] != 'directory' and _owner(name, snapshot['package_roots']) is None)
    return {'version': 1, 'classification': 'OFFLINE_PUBLIC_NPM_SRI_FILE_COMPARISON_NOT_QUALIFIED',
        'cacheOriginalIntegral': False, 'fullVendorIntegrity': False, 'qualified': False,
        'root_review_required': True, 'inputs': snapshot['inputs'], 'packages': rows,
        'metadata_gaps': gaps, 'unowned_install_metadata_requires_review': unowned,
        'counts': {'installed_packages': len(snapshot['package_roots']), 'metadata_gaps': len(gaps),
                   'comparisons': len(rows), 'file_comparison_matches': sum(row['status'] == 'file_comparison_matches_only' for row in rows),
                   'unowned_install_metadata': len(unowned)}}
