import pathlib,hashlib,tempfile,unittest,subprocess,os
from unittest import mock
import functional_smoke as f

class RuntimePreflightTests(unittest.TestCase):
 def test_unknown_env_and_symlink_rejected_before_copy(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'x').write_bytes(b'known');manifest={'files':{'x':{'bytes':5,'sha256':hashlib.sha256(b'known').hexdigest()}}};self.assertTrue(f.verify_runtime_tree(root,manifest));(root/'.env.local').write_text('fixture only');self.assertFalse(f.verify_runtime_tree(root,manifest));(root/'.env.local').unlink();(root/'link').symlink_to('/etc/passwd');self.assertFalse(f.verify_runtime_tree(root,manifest))
 def test_corrupt_bytes_rejected(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'x').write_bytes(b'wrong');manifest={'files':{'x':{'bytes':5,'sha256':hashlib.sha256(b'known').hexdigest()}}};self.assertFalse(f.verify_runtime_tree(root,manifest))
 def test_no_kill_for_foreign_node_cgroup(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'123').mkdir();proc=mock.Mock(pid=123)
   with mock.patch.object(f,'members',return_value=[123]),mock.patch.object(f,'cgroup_of',return_value='/foreign'),mock.patch.object(f.os,'killpg') as kill:
    with self.assertRaises(RuntimeError):f.stop_owned_node(proc,'/own','12345',root)
    kill.assert_not_called()
 def test_no_kill_for_reused_node_pid(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d);(root/'123').mkdir();fields=['S']+['0']*18+['changed']+['0']*5;(root/'123/stat').write_text('123 (node) '+' '.join(fields));proc=mock.Mock(pid=123)
   with mock.patch.object(f,'members',return_value=[123]),mock.patch.object(f,'cgroup_of',return_value='/own'),mock.patch.object(f.os,'killpg') as kill:
    with self.assertRaises(RuntimeError):f.stop_owned_node(proc,'/own','expected',root)
    kill.assert_not_called()
if __name__=='__main__':unittest.main()
