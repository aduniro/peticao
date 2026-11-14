import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]


class ActualPermissionTests(unittest.TestCase):
    def test_umask077_actual_nonroot_imports_and_unfixed_control_denied(self):
        self.assertNotEqual(os.getuid(),0,'Run test suite as operational nonroot user with sudo-n for bounded fixture helper')
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as fixture:
            p=subprocess.run(['sudo','-n','/usr/bin/python3','-I','-B',str(ROOT/'tests/root_permissions.py'),fixture,str(os.getuid()),str(os.getgid())],capture_output=True,text=True,timeout=45)
            self.assertEqual(p.returncode,0,p.stderr[-2000:])
            r=json.loads(p.stdout)
            self.assertTrue(r['umask077_control_mode700_denied_actual_nonroot'])
            self.assertTrue(r['actual_nonroot_imports_pass'])
            self.assertFalse(r['host_account_created'])
            self.assertFalse(r['queue_created'])


if __name__=='__main__':unittest.main()
