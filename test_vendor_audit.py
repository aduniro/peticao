"""Fictitious tars/HTTP response objects only. No network/install/code import."""
import base64
from copy import deepcopy
import hashlib
import io
import json
import os
from pathlib import Path
import stat
import tarfile
import tempfile
import unittest
from unittest import mock

import vendor_audit as audit

TMP = Path('/mnt/apps/peticao-final/infra-public-inputs-20261115/vendor-audit-source/test-state/tmp')
URL = 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz'


def integrity(raw):
    return 'sha512-' + base64.b64encode(hashlib.sha512(raw).digest()).decode()


def tar_bytes(rows):
    target = io.BytesIO()
    with tarfile.open(fileobj=target, mode='w:gz') as archive:
        for name, raw, kind in rows:
            member = tarfile.TarInfo(name); member.mode = 0o644
            if kind == 'file':
                member.size = len(raw); archive.addfile(member, io.BytesIO(raw))
            elif kind == 'executable':
                member.mode = 0o755; member.size = len(raw); archive.addfile(member, io.BytesIO(raw))
            elif kind in ('symlink', 'hardlink'):
                member.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE
                member.linkname = raw; archive.addfile(member)
            elif kind == 'directory':
                member.type = tarfile.DIRTYPE; member.mode = 0o755; archive.addfile(member)
            else:
                member.type = tarfile.FIFOTYPE; archive.addfile(member)
    return target.getvalue()


def file_entry(raw, executable=False):
    return {'kind': 'file', 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw),
            'elf': raw.startswith(b'\x7fELF'), 'executable': executable}


class Response:
    def __init__(self, raw, url=URL, status=200, length=None):
        self.fp = io.BytesIO(raw); self.url = url; self.status = status
        self.headers = {'Content-Length': str(len(raw)) if length is None else length}
        self.read_sizes = []
    def geturl(self): return self.url
    def read(self, count): self.read_sizes.append(count); return self.fp.read(count)
    def __enter__(self): return self
    def __exit__(self, *args): self.fp.close()


class VendorAuditTests(unittest.TestCase):
    def setUp(self):
        TMP.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='vendor-fixture-', dir=TMP)
        self.root = Path(self.temp.name)

    def tearDown(self): self.temp.cleanup()

    def test_registry_urls_only_no_credentials_ports_redirect_host_or_query(self):
        self.assertEqual(audit.validate_url(URL), URL)
        self.assertEqual(audit.validate_url('https://registry.npmjs.org/@scope/pkg/-/pkg-1.tgz'),
                         'https://registry.npmjs.org/@scope/pkg/-/pkg-1.tgz')
        for bad in ('http://registry.npmjs.org/p.tgz', 'https://registry.npmjs.org:443/p.tgz',
                    'https://user:fake@registry.npmjs.org/p.tgz', 'https://registry.npmjs.org.evil/p.tgz',
                    'https://127.0.0.1/p.tgz', URL+'?token=fictitious', URL+'#fragment',
                    'https://registry.npmjs.org/%2e%2e/p.tgz', 'https://registry.npmjs.org/a%0ab.tgz',
                    'https://registry.npmjs.org//p.tgz', 'https://registry.npmjs.org/a%5cb.tgz'):
            with self.subTest(url=bad), self.assertRaises(audit.AuditRejected): audit.validate_url(bad)

    def test_strict_single_canonical_sha512_sri(self):
        value = integrity(b'fictitious')
        self.assertEqual(audit.parse_integrity(value), hashlib.sha512(b'fictitious').digest())
        for bad in ('sha256-'+value[7:], value+' '+value, value+'\n', value[:-1], value.replace('==','='),
                    'sha512-'+'A'*86+'!=', None):
            with self.assertRaises((ValueError, TypeError)): audit.parse_integrity(bad)

    def test_package_boundary_and_longest_prefix(self):
        for name in ('node_modules/pkg', 'node_modules/@scope/pkg', 'node_modules/pkg/node_modules/child'):
            self.assertTrue(audit.package_root(name))
        for name in ('node_modules', 'node_modules/@scope', 'node_modules/pkg/lib', 'pkg'):
            self.assertFalse(audit.package_root(name))
        roots = ['node_modules/a', 'node_modules/ab', 'node_modules/a/node_modules/nested']
        self.assertEqual(audit._owner('node_modules/ab/a.js', roots), 'node_modules/ab')
        self.assertEqual(audit._owner('node_modules/a/node_modules/nested/a.js', roots), roots[-1])
        self.assertIsNone(audit._owner('node_modules/.bin/a', roots))

    def test_regular_vendor_tar_hash_inventory_no_extract(self):
        raw = tar_bytes([('package/package.json', b'{"name":"fixture","version":"1.0.0"}', 'file'),
                         ('package/lib/a.js', b'fixture module never executed', 'file')])
        with mock.patch.object(tarfile.TarFile, 'extractall', side_effect=AssertionError('no extraction')):
            result = audit.inspect_vendor_tar(io.BytesIO(raw))
        self.assertEqual(set(result), {'package.json', 'lib/a.js'})
        self.assertEqual(result['lib/a.js'], file_entry(b'fixture module never executed'))

    def test_vendor_prefix_traversal_duplicates_and_special_refused(self):
        for rows in ([('../escape', b'bad', 'file')], [('other/a', b'bad', 'file')],
                     [('package/a', b'a', 'file'), ('package/a', b'b', 'file')], [('package/fifo', b'', 'special')]):
            with self.subTest(rows=rows), self.assertRaises(audit.AuditRejected):
                audit.inspect_vendor_tar(io.BytesIO(tar_bytes(rows)))

    def test_symlinks_remain_metadata_never_followed(self):
        rows = [('package/a', b'fixture', 'file'), ('package/link', 'a', 'symlink')]
        result = audit.inspect_vendor_tar(io.BytesIO(tar_bytes(rows)))
        self.assertEqual(result['link'], {'kind': 'symlink', 'target': 'package/a'})
        for target in ('../../outside', '/etc/passwd'):
            with self.assertRaises(audit.AuditRejected):
                audit.inspect_vendor_tar(io.BytesIO(tar_bytes([('package/link', target, 'symlink')])))

    def test_hardlink_is_logical_archive_hash_only(self):
        rows = [('node_modules/pkg/a', b'fixture', 'file'),
                ('node_modules/pkg/b', 'node_modules/pkg/a', 'hardlink')]
        result = audit._inventory(io.BytesIO(tar_bytes(rows)), 'deps')
        self.assertEqual(result['entries']['node_modules/pkg/b']['sha256'], hashlib.sha256(b'fixture').hexdigest())
        self.assertEqual(list(self.root.iterdir()), [])

    def test_tar_bound_exceeded_never_enlarges_automatically(self):
        raw = tar_bytes([('package/a', b'fixture', 'file')])
        with mock.patch.object(audit, 'MAX_UNPACKED', 2), self.assertRaises(audit.AuditRejected):
            audit.inspect_vendor_tar(io.BytesIO(raw))

    def test_hidden_pax_payload_bound_precedes_json_or_member_allocation(self):
        header = tarfile.TarInfo('pax'); header.type = tarfile.XHDTYPE; header.size = 65537
        raw = header.tobuf(format=tarfile.USTAR_FORMAT) + b'A' * 65537 + b'\0' * 2048
        with self.assertRaisesRegex(audit.AuditRejected, 'pax_header'):
            audit.inspect_vendor_tar(io.BytesIO(raw))

    def test_metadata_duplicate_and_nonfinite_refused(self):
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}'):
            with self.assertRaises(ValueError): audit._json(raw)

    def test_download_sri_private_exclusive_and_bounded_stream(self):
        raw = tar_bytes([('package/a', b'fictitious', 'file')]); response = Response(raw)
        plan = {'resolved': URL, 'integrity': integrity(raw)}
        root = self.root/'downloads'
        result = audit.download_tarball(root, 'node_modules/pkg', plan, lambda _: response)
        self.assertTrue(result['sri_verified'])
        self.assertEqual((root/result['filename']).read_bytes(), raw)
        self.assertEqual(stat.S_IMODE((root/result['filename']).stat().st_mode), 0o600)
        self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
        self.assertTrue(all(size == audit.CHUNK for size in response.read_sizes))
        with self.assertRaises(FileExistsError):
            audit.download_tarball(root, 'node_modules/pkg', plan, lambda _: Response(raw))

    def test_download_sri_mismatch_preserved_not_approved(self):
        root = self.root/'bad-sri'
        with self.assertRaises(audit.AuditRejected):
            audit.download_tarball(root, 'node_modules/pkg', {'resolved':URL,'integrity':integrity(b'other')},
                                   lambda _:Response(b'fictitious'))
        files = list(root.iterdir())
        self.assertEqual(len(files), 1); self.assertEqual(files[0].read_bytes(), b'fictitious')

    def test_redirect_and_size_limits_refused_without_transport_expansion(self):
        raw = b'fictitious'; plan = {'resolved': URL, 'integrity': integrity(raw)}
        for index, response in enumerate((Response(raw, url='https://example.invalid/p.tgz'),
                                         Response(raw, status=302), Response(raw, length=str(audit.MAX_DOWNLOAD+1)))):
            with self.assertRaises(audit.AuditRejected):
                audit.download_tarball(self.root/('refused-'+str(index)), 'node_modules/pkg', plan, lambda _: response)
        with mock.patch.object(audit, 'MAX_DOWNLOAD', 3), self.assertRaises(audit.AuditRejected):
            audit.download_tarball(self.root/'size-limit', 'node_modules/pkg', plan, lambda _: Response(raw, length='9'))
        self.assertIsNone(audit._NoRedirect().redirect_request(None,None,302,'',{},'https://example.invalid'))

    def test_transport_disables_environment_proxy_and_redirect(self):
        with mock.patch.object(audit.urllib.request, 'build_opener') as build:
            audit._transport(URL)
        handlers = build.call_args.args
        self.assertEqual(handlers[0].proxies, {})
        self.assertIsInstance(handlers[1], audit._NoRedirect)
        self.assertEqual(build.return_value.open.call_args.kwargs['timeout'], 20)

    def test_aggregate_budget_and_deadline_fail_closed(self):
        raw = b'fictitious'; plan = {'resolved':URL,'integrity':integrity(raw)}
        root = self.root/'aggregate'
        with mock.patch.object(audit, 'MAX_TOTAL_DOWNLOAD', len(raw)):
            audit.download_tarball(root, 'node_modules/a', plan, lambda _:Response(raw))
            with self.assertRaisesRegex(audit.AuditRejected, 'aggregate'):
                audit.download_tarball(root, 'node_modules/b', plan, lambda _:Response(raw))
        with mock.patch.object(audit.time, 'monotonic', side_effect=[0, 61]), self.assertRaisesRegex(audit.AuditRejected, 'deadline'):
            audit.download_tarball(self.root/'deadline', 'node_modules/pkg', plan, lambda _:Response(raw))

    def test_download_directory_symlink_foreign_mode_and_outside_project_refused(self):
        target = self.root/'target'; target.mkdir(mode=0o700)
        link = self.root/'link'; link.symlink_to(target, target_is_directory=True)
        plan = {'resolved':URL,'integrity':integrity(b'fixture')}
        with self.assertRaises(OSError): audit.download_tarball(link, 'node_modules/pkg', plan, lambda _:Response(b'fixture'))
        target.chmod(0o755)
        with self.assertRaises(audit.AuditRejected): audit.download_tarball(target, 'node_modules/pkg', plan, lambda _:Response(b'fixture'))
        with self.assertRaises(audit.AuditRejected): audit.download_tarball('/tmp/never-create', 'node_modules/pkg', plan)
        with mock.patch.object(audit.os, 'geteuid', return_value=0), self.assertRaisesRegex(audit.AuditRejected, 'uid_1000'):
            audit.download_tarball(self.root/'never-root', 'node_modules/pkg', plan)
        self.assertFalse((self.root/'never-root').exists())

    def test_comparison_missing_extra_hash_mode_and_esbuild_are_not_passes(self):
        root = 'node_modules/esbuild'
        actual = {root+'/bin/esbuild': file_entry(b'\x7fELFfixture', True), root+'/generated':file_entry(b'extra')}
        vendor = {'bin/esbuild':file_entry(b'#!/usr/bin/env node\nstub', True), 'missing':file_entry(b'absent')}
        row = audit.compare_package(root, actual, vendor, [root])
        self.assertEqual(row['missing'], ['missing']); self.assertEqual(row['extra'], ['generated'])
        self.assertEqual(len(row['differences']), 1)
        self.assertEqual(len(row['postinstall_candidates_unapproved']), 1)
        self.assertFalse(row['fullVendorIntegrity']); self.assertTrue(row['root_review_required'])

    def test_nested_package_files_are_not_captured_by_parent(self):
        roots = ['node_modules/pkg', 'node_modules/pkg/node_modules/child']
        actual = {roots[0]+'/a':file_entry(b'a'), roots[1]+'/b':file_entry(b'b')}
        vendor = {'a':file_entry(b'a'), 'node_modules/child/b':file_entry(b'b')}
        row = audit.compare_package(roots[0], actual, vendor, roots)
        self.assertEqual(row['installed_files'], 1); self.assertEqual(row['vendor_files'], 1)
        self.assertEqual(row['delegated_nested_package_files'], 1)
        self.assertEqual(row['status'], 'file_comparison_matches_only')
        self.assertFalse(row['fullVendorIntegrity'])

    def test_unchanged_links_require_review_even_when_both_types_match(self):
        root = 'node_modules/pkg'; link = {'kind':'symlink','target':'same'}
        row = audit.compare_package(root, {root+'/link':link}, {'link':link}, [root])
        self.assertEqual(row['link_metadata_requires_review'], ['link'])
        self.assertEqual(row['status'], 'gaps_require_root_review')

    def test_plan_requires_registry_sri_no_local_or_unpinned_fallback(self):
        snapshot = {'package_roots':['node_modules/a','node_modules/b'], 'lock':{'packages':{
            'node_modules/a':{'resolved':URL,'integrity':integrity(b'fixture')},
            'node_modules/b':{'resolved':'file:../local','integrity':None}}}}
        plans, gaps = audit.plan_packages(snapshot)
        self.assertEqual(set(plans), {'node_modules/a'}); self.assertEqual(len(gaps), 1)

    def test_network_default_disabled_and_fake_full_run_stays_unqualified(self):
        raw = tar_bytes([('package/a', b'fixture', 'file')]); root = 'node_modules/pkg'
        snapshot = {'inputs':{'fixture':True},'package_roots':[root],
            'installed':{root+'/a':file_entry(b'fixture'), 'node_modules/.bin/tool':{'kind':'symlink','target':root+'/a'}},
            'lock':{'packages':{root:{'resolved':URL,'integrity':integrity(raw)}}}}
        with self.assertRaises(audit.AuditRejected): audit.run_vendor_audit(snapshot)
        result = audit.run_vendor_audit(snapshot, self.root/'run-downloads', allow_public_download=True,
                                        transport=lambda _:Response(raw))
        self.assertEqual(result['counts']['file_comparison_matches'], 1)
        self.assertFalse(result['fullVendorIntegrity']); self.assertFalse(result['cacheOriginalIntegral'])
        self.assertTrue(result['root_review_required'])
        self.assertEqual(result['unowned_install_metadata_requires_review'], ['node_modules/.bin/tool'])
        self.assertNotIn(URL, json.dumps(result))

    def test_pinned_data_same_fd_hash_before_after_and_no_guard_substitution(self):
        path = self.root/'input.tgz'; raw = b'fictitious pinned data'; path.write_bytes(raw)
        sha = hashlib.sha256(raw).hexdigest()
        with audit._pinned_data(str(path), sha, len(raw)) as stream:
            self.assertEqual(stream.read(), raw)
        with self.assertRaises(audit.AuditRejected):
            with audit._pinned_data(str(path), 'a'*64, len(raw)): pass
        with self.assertRaises(audit.AuditRejected):
            with audit._pinned_data(str(path), sha, len(raw)) as stream:
                path.write_bytes(b'changed pinned fixture')


if __name__ == '__main__': unittest.main()
