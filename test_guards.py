import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import subprocess
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('op',ROOT/'operator.py');op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)
class Guards(unittest.TestCase):
 def test_new_plan(self):self.assertEqual(op.plan('Inst cmake (3.2 Ubuntu:noble [amd64])'),{'cmake':'3.2'})
 def test_upgrade_forbidden(self):
  with self.assertRaises(ValueError):op.plan('Inst cmake [3.1] (3.2 Ubuntu:noble [amd64])')
 def test_remove_forbidden(self):
  with self.assertRaises(ValueError):op.plan('Remv ssh [1]\nInst cmake (3.2 Ubuntu:noble [amd64])')
 def test_empty_forbidden(self):
  with self.assertRaises(ValueError):op.plan('0 upgraded')
 def test_duplicate_forbidden(self):
  with self.assertRaises(ValueError):op.plan('Inst cmake (3 Ubuntu)\nInst cmake (3 Ubuntu)')
 def test_service_scripts_rejected(self):
  for s in ['systemctl restart ssh','invoke-rc.d ssh start','deb-systemd-helper enable x','start-stop-daemon --start']:
   self.assertIsNotNone(op.DANGER.search(s))
 def test_nonservice_cache_updates_allowed(self):
  for s in ['ldconfig','update-alternatives --install','update-mime-database /usr/share/mime']:self.assertIsNone(op.DANGER.search(s))
 def test_wrong_host_stops_before_package_commands(self):
  with patch.object(op.os,'geteuid',return_value=0),patch.object(op.socket,'gethostname',return_value='peticao-sp'),patch.object(op,'run') as run:
   with self.assertRaises(PermissionError):op.main({})
   run.assert_not_called()
 def test_wrong_closure_stops_before_package_commands(self):
  with patch.object(op.os,'geteuid',return_value=0),patch.object(op.socket,'gethostname',return_value='peticao-civo'),patch.object(op,'run') as run:
   with self.assertRaises(ValueError):op.main({'pins':{},'sha256':{}})
   run.assert_not_called()
if __name__=='__main__':unittest.main()
