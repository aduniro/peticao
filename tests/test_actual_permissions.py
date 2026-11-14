import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]


class ActualPermissions(unittest.TestCase):
    def test_real_dropped_uid_can_read_every_file_and_execute_only_fixture_script(self):
        self.assertNotEqual(os.getuid(),0)
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as fixture,tempfile.TemporaryDirectory(dir='/mnt/apps/peticao-final/.gpt1') as short:
            result=subprocess.run(['sudo','-n','/usr/bin/python3','-I','-B',str(ROOT/'tests/root_fixture.py'),fixture,str(os.getuid()),str(os.getgid()),short],capture_output=True,text=True,timeout=45)
            self.assertEqual(result.returncode,0,result.stderr[-1800:])
            data=json.loads(result.stdout);probe=data['actual_nonroot_probe']
            self.assertEqual(len(probe['primary_operations_rejected']),5)
            self.assertTrue(probe['queue_file_unchanged'])
            self.assertTrue(data['fictional_script_executable'])
            self.assertFalse(data['real_accounts_changed'])
            self.assertTrue(data['real_root_decrypt_integrity_pass'])
            self.assertTrue(data['unlock_stdin_only_no_file_success_or_failure'])
            self.assertTrue(data['altered_probe_import_hash_refused'])


if __name__=='__main__':unittest.main()
