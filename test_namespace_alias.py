"""Source successor's fixed alias and IPC forecast; no mount or host process."""
from pathlib import Path
import unittest
from unittest import mock

import driver
import qa_adapter


class NamespaceAlias(unittest.TestCase):
    def test_only_exact_new_alias_or_existing_state_shape(self):
        for path in ('/run/peticao-dev-work', '/var/lib/peticao-dev-job-'+'a'*32+'-g1',
                     '/var/lib/private/peticao-dev-job-'+'f'*32+'-g2'):
            self.assertTrue(driver.approved_workdir(path))
        for path in ('/run/w', '/tmp/peticao-dev-work', '/run/peticao-dev-work/child',
                     '/run/peticao-dev-work-other', '/var/lib/peticao-dev-job-bad-g1',
                     'run/peticao-dev-work', '/run/../run/peticao-dev-work'):
            self.assertFalse(driver.approved_workdir(path))

    def test_short_namespace_alias_static_forecast_fits_both_limits(self):
        with mock.patch('os.open', side_effect=AssertionError('no IO')):
            result=qa_adapter.measure_ipc(driver.NAMESPACE_WORK_ALIAS)
        self.assertEqual(result['tmp']['relative_bytes'],72)
        self.assertEqual(result['tmp']['absolute_bytes'],94)
        self.assertEqual(result['home']['absolute_bytes'],67)
        self.assertTrue(all(max(r['relative_bytes'],r['absolute_bytes'])<108 for r in result.values()))

    def test_legacy_long_state_alias_is_still_not_qa_qualified(self):
        for prefix in ('/var/lib/','/var/lib/private/'):
            path=prefix+'peticao-dev-job-'+'a'*32+'-g1'
            with self.assertRaises(qa_adapter.QAPending): qa_adapter.measure_ipc(Path(path))

    def test_no_mount_or_free_input_path_added_to_job_recipe(self):
        import driver_contract
        p=driver_contract.plan('admin-qa-v1')
        self.assertIs(p['qualification']['qualified'],False)
        self.assertIs(p['qualification']['operationalReady'],False)
        self.assertEqual(p['layout']['relative_to'],'trusted_StateDirectory_namespace_alias')
        self.assertNotIn('mount',p)


if __name__=='__main__': unittest.main()
