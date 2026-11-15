import copy
import os
from pathlib import Path
import tempfile
import unittest

import contract as c
import probe


def test_tmpdir():
    # A reviewer may select a shorter OWN project directory when copying tests.
    path = Path(os.environ.get('PETICAO_ALIAS_TEST_TMPDIR', str(Path(__file__).resolve().parents[1])))
    if not path.resolve().is_relative_to('/mnt/apps/peticao-final'):
        raise ValueError('local test temporary root must remain in project')
    return path


class ProbeTests(unittest.TestCase):
    def test_real_local_unix_socket_exchange_under_project(self):
        with tempfile.TemporaryDirectory(prefix='sock-', dir=test_tmpdir()) as root:
            self.assertTrue(probe.unix_roundtrip(Path(root) / 's'))
            self.assertFalse((Path(root) / 's').exists())

    def test_existing_file_not_overwritten(self):
        with tempfile.TemporaryDirectory(prefix='sock-', dir=test_tmpdir()) as root:
            path = Path(root) / 's'; path.write_text('preserved')
            with self.assertRaises(ValueError): probe.unix_roundtrip(path)
            self.assertEqual(path.read_text(), 'preserved')

    def test_long_socket_rejected(self):
        with self.assertRaises(ValueError): probe.unix_roundtrip('/' + 'a' * 108)

    def test_fixed_short_socket(self):
        self.assertLessEqual(len(c.socket_path(c.ALIAS + '/t/.s.PGSQL.65432').encode()), 107)
        for value in ('/tmp/a', c.ALIAS + '/t/' + 'a' * 100, c.ALIAS + '/t/../outside'):
            with self.subTest(value=value), self.assertRaises(ValueError): c.socket_path(value)

    def test_properties_preserve_namespace_and_do_not_execute(self):
        p = c.proposed_properties('a' * 32)
        self.assertEqual(p['DynamicUser'], 'yes')
        self.assertEqual(p['PrivateTmp'], 'yes')
        self.assertEqual(p['PrivateNetwork'], 'yes')
        self.assertEqual(p['TemporaryFileSystem'], '/run:rw')
        self.assertEqual(p['WorkingDirectory'], c.ALIAS)
        self.assertTrue(p['BindPaths'].endswith(':' + c.ALIAS))
        with self.assertRaises(ValueError): c.proposed_properties('../invalid')

    def proof(self):
        job = 'a' * 32
        child = {'alias': c.ALIAS, 'logical_state': '/var/lib/peticao-dev-job-' + job + '-g1',
                 'uid': 62000, 'alias_stat': [1, 2], 'state_stat': [1, 2],
                 'mount_namespace': 3, 'socket_path': c.ALIAS + '/t/.s.PGSQL.65432'}
        child.update(run_stat=[5, 6], run_filesystem='tmpfs')
        child.update({k: True for k in ('zero_capabilities', 'no_new_privileges', 'private_network',
                                      'physical_path_hidden', 'system_tmp_inaccessible', 'roundtrip')})
        host = {'alias_exists': False, 'manager_namespace_verified': True, 'mount_namespace': 4, 'run_stat': [7, 8]}
        physical = {'device': 1, 'inode': 2, 'source': c.PROJECT + '/fixture/work'}
        return job, child, host, physical

    def test_valid_evidence_not_operational_qualification(self):
        job, child, host, physical = self.proof()
        result = c.validate_observation(job, child, host, host, physical, host_during=host)
        self.assertTrue(result['evidence_consistent'])
        self.assertFalse(result['operational_ready'])

    def test_root_or_changed_backing_refused(self):
        job, child, host, physical = self.proof()
        for field, value in [('uid', 0), ('alias_stat', [9, 9]), ('roundtrip', False), ('physical_path_hidden', False)]:
            changed = copy.deepcopy(child); changed[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): c.validate_observation(job, changed, host, host, physical, host_during=host)

    def test_host_alias_or_shared_namespace_refused(self):
        job, child, host, physical = self.proof()
        for field, value in [('alias_exists', True), ('manager_namespace_verified', False), ('mount_namespace', 3)]:
            changed = dict(host); changed[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError): c.validate_observation(job, child, changed, changed, physical, host_during=changed)

    def test_missing_or_changed_manager_identity_refused(self):
        job, child, host, physical = self.proof()
        for value in (None, 0, True, 8):
            changed = dict(host); changed['mount_namespace'] = value
            with self.subTest(value=value), self.assertRaises(ValueError): c.validate_observation(job, child, host, changed, physical, host_during=host)

    def test_boolean_stat_members_and_tuple_refused(self):
        job, child, host, physical = self.proof()
        for value in ([True, 2], [1, True], (1, 2), [1, 2, 3]):
            changed = dict(child); changed['alias_stat'] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                c.validate_observation(job, changed, host, host, physical, host_during=host)

    def test_missing_during_observation_refused(self):
        job, child, host, physical = self.proof()
        with self.assertRaises(ValueError): c.validate_observation(job, child, host, host, physical)
        changed = dict(host); changed['alias_exists'] = True
        with self.assertRaises(ValueError): c.validate_observation(job, child, host, host, physical, host_during=changed)

    def test_shared_or_unproven_run_refused(self):
        job, child, host, physical = self.proof()
        for changes in ({'run_stat': host['run_stat']}, {'run_filesystem': 'ext4'}, {'run_stat': [True, 6]}):
            changed = dict(child); changed.update(changes)
            with self.subTest(changes=changes), self.assertRaises(ValueError):
                c.validate_observation(job, changed, host, host, physical, host_during=host)


if __name__ == '__main__':
    unittest.main()
