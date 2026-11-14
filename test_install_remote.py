import argparse
import ast
import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import install_remote as driver


class BoundTransport(unittest.TestCase):
    def test_every_ssh_rechecks_authority_and_expired_fence_sends_nothing(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch.object(driver,'BASE',Path(tmp)),patch.object(driver,'gate') as gate,patch.object(driver.subprocess,'run') as run:
                run.return_value=argparse.Namespace(returncode=0,stdout=b'ok',stderr=b'')
                driver.remote('print(1)');driver.remote('print(2)')
                self.assertEqual(gate.call_count,2)
                gate.side_effect=ValueError('expired')
                with self.assertRaises(ValueError):driver.remote('must not reach SSH')
                self.assertEqual(run.call_count,2)

    def test_remote_bootstrap_and_restore_reject_changed_bytes_before_execution(self):
        for step,target in [('start','bootstrap.sh'),('finish','restore_credentials.py')]:
            with self.subTest(step=step),tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp);original=b'reviewed bytes'
                (root/target).write_bytes(original)
                binding={'remote_sha256':{target:hashlib.sha256(original).hexdigest()}}
                captured=[]
                with patch.object(driver,'STAGE',str(root)),patch.object(driver,'gate',return_value=binding),patch.object(driver,'remote',side_effect=lambda code,**kw:captured.append(code) or b'ok'):
                    driver.main(argparse.Namespace(step=step))
                outer=ast.parse(captured[0])
                root_program=next(node.value for node in ast.walk(outer) if isinstance(node,ast.Constant) and isinstance(node.value,str) and 'Remote artifact changed' in node.value)
                (root/target).write_bytes(b'changed after stage')
                with self.assertRaisesRegex(ValueError,'Remote artifact changed'):
                    exec(compile(root_program,'remote-root-guard','exec'),{})


if __name__=='__main__':unittest.main()
