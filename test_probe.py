"""All path and mount information is fictitious; tests never inspect actual homes."""
import io
import os
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch

import probe


class ProbeTests(unittest.TestCase):
    def test_mount_parser_filters_exact_targets_and_redacts_sources(self):
        raw = '\n'.join([
            '1 0 0:1 / / rw,relatime - ext4 /dev/private-root rw',
            '2 1 0:2 / /home ro,nosuid,nodev - tmpfs tmpfs ro,size=1024k,mode=755',
            '3 1 0:3 / /root ro,nosuid - tmpfs tmpfs ro',
            '4 1 0:4 /private/subtree /run/user ro - ext4 /secret/device rw,password=TOP_SECRET',
            '5 1 0:5 / /home/other-user ro - tmpfs tmpfs ro',
            '6 1 0:6 / /home/civo ro - tmpfs tmpfs ro',
            'malformed',
        ])
        rows = probe.parse_mountinfo(raw)
        self.assertEqual([r['mountpoint'] for r in rows], ['/home', '/root', '/run/user', '/home/civo'])
        self.assertEqual(rows[0]['source'], 'tmpfs')
        self.assertEqual(rows[2]['source'], 'redacted')
        self.assertEqual(rows[2]['filesystem_root'], 'subtree')
        self.assertNotIn('TOP_SECRET', str(rows))
        self.assertNotIn('/secret/device', str(rows))
        self.assertEqual(probe.unescape_mount('/space\\040here'), '/space here')

    def test_metadata_counts_without_accessing_names_or_file_contents(self):
        class NoNames:
            @property
            def name(self):
                raise AssertionError('Filenames must not be inspected')
        stream = MagicMock()
        stream.__enter__.return_value = iter([NoNames() for _ in range(1005)])
        with patch.object(probe.os, 'statvfs', return_value=SimpleNamespace(f_flag=os.ST_RDONLY)), patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_dev=11, st_ino=22)), patch.object(Path, 'exists', return_value=True), patch.object(Path, 'is_dir', return_value=True), patch.object(probe.os, 'access', return_value=True), patch.object(probe.os, 'scandir', return_value=stream) as scan, patch.object(Path, 'open', side_effect=AssertionError('No content reads')), patch.object(Path, 'read_bytes', side_effect=AssertionError('No key reads')):
            row = probe.metadata('/home')
        self.assertEqual(row['mode'], '0755')
        self.assertEqual(row['child_count'], 1000)
        self.assertTrue(row['child_count_limited'])
        self.assertEqual(row['credential_directories_visible'], {'.ssh': True, '.codex': True, '.config': True})
        scan.assert_called_once_with(Path('/home'))

    def test_inaccessible_metadata_has_no_content_or_filename_output(self):
        with patch.object(probe.os, 'statvfs', return_value=SimpleNamespace(f_flag=os.ST_RDONLY)), patch.object(Path, 'lstat', side_effect=PermissionError), patch.object(Path, 'is_dir', return_value=False), patch.object(probe.os, 'access', return_value=False), patch.object(probe.os, 'scandir', side_effect=AssertionError('Do not enumerate inaccessible paths')), patch.object(Path, 'open', side_effect=AssertionError('No content reads')):
            row = probe.metadata('/root')
        self.assertFalse(row['exists'])
        self.assertFalse(row['readable'])
        self.assertIsNone(row['child_count'])
        self.assertEqual(row['metadata_error'], 'PermissionError')

    def test_empty_visible_tmpfs_is_distinct_from_visible_credentials(self):
        stream = MagicMock()
        stream.__enter__.return_value = iter([])
        with patch.object(probe.os, 'statvfs', return_value=SimpleNamespace(f_flag=os.ST_RDONLY)), patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=stat.S_IFDIR | 0o755, st_dev=11, st_ino=22)), patch.object(Path, 'exists', return_value=True), patch.object(Path, 'is_dir', side_effect=lambda p=None: True) as is_dir, patch.object(probe.os, 'access', return_value=True), patch.object(probe.os, 'scandir', return_value=stream):
            is_dir.side_effect = [True, False, False, False]
            row = probe.metadata('/root')
        self.assertTrue(row['exists'])
        self.assertTrue(row['readable'])
        self.assertEqual(row['child_count'], 0)
        self.assertFalse(any(row['credential_directories_visible'].values()))

    def test_collect_explicit_paths_and_kernel_security_without_host_inspection(self):
        status = 'NoNewPrivs: 1\nCapEff: 0000\nUid: 1234\nSensitive: hidden'
        def fake_open(path, mode, **kwargs):
            self.assertEqual(mode, 'r')
            return io.StringIO(status if path.endswith('status') else '')
        def fake_scandir(path):
            stream = MagicMock()
            stream.__enter__.return_value = iter([SimpleNamespace(name='lo')] if path == '/sys/class/net' else [SimpleNamespace(name='1'), SimpleNamespace(name='self')])
            return stream
        with patch('builtins.open', side_effect=fake_open), patch.object(probe, 'metadata', side_effect=lambda value: {'path': value}), patch.object(probe.os, 'scandir', side_effect=fake_scandir):
            row = probe.collect(['/fixture/retained', '/fixture/work', '/fixture/retained'])
        self.assertEqual(row['extra_paths'], [{'path': '/fixture/retained'}, {'path': '/fixture/work'}])
        self.assertTrue(row['loopback_only'])
        self.assertEqual(row['visible_numeric_process_entries'], 1)
        self.assertEqual(row['process_security'], {'NoNewPrivs': '1', 'CapEff': '0000'})
        self.assertEqual(row['socket_connect_test'], 'not_performed_metadata_only')

    def test_report_only_opens_kernel_mount_metadata_readonly(self):
        calls = []
        def fake_open(path, mode, **kwargs):
            calls.append((path, mode))
            self.assertIn(path, ['/proc/self/mountinfo', '/proc/self/status'])
            self.assertEqual(mode, 'r')
            return io.StringIO('1 0 0:1 / /root ro - tmpfs tmpfs ro' if path.endswith('mountinfo') else 'NoNewPrivs: 1\nCapEff: 0000000000000000\nName: DO_NOT_REPORT')
        with patch('builtins.open', side_effect=fake_open), patch.object(probe.os, 'scandir', side_effect=PermissionError), patch.object(probe, 'metadata', side_effect=lambda value: {'path': value}), patch.object(probe.os, 'geteuid', return_value=1234), patch.object(probe.os, 'getegid', return_value=1234), patch.object(probe.os, 'getgroups', return_value=[1234]), patch.object(Path, 'write_text', side_effect=AssertionError('No writes')), patch.object(Path, 'read_bytes', side_effect=AssertionError('No key reads')):
            row = probe.report()
        self.assertEqual(calls, [('/proc/self/mountinfo', 'r'), ('/proc/self/status', 'r')])
        self.assertEqual(row['uid'], 1234)
        self.assertEqual([r['path'] for r in row['paths']], list(probe.PATHS))
        self.assertTrue(row['metadata_only'])
        self.assertEqual(row['process_security'], {'NoNewPrivs': '1', 'CapEff': '0000000000000000'})
        self.assertNotIn('DO_NOT_REPORT', str(row))


if __name__ == '__main__':
    unittest.main()
