import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('passive_operator',ROOT/'operator.py')
op=importlib.util.module_from_spec(spec);spec.loader.exec_module(op)


class OperatorTests(unittest.TestCase):
    def test_start_promote_and_stop_are_not_remote_actions(self):
        for action in ['start','promote','stop','enable']:
            with patch.object(op,'guard'),patch.object(op,'load_helper',return_value=(object(),object())),patch.object(op,'run') as run:
                with self.assertRaises(ValueError):op.main({'role':'target','action':action,'capture':{}})
                run.assert_not_called()

    def test_nonroot_or_wrong_host_rejected_before_state_changes(self):
        with patch.object(op.os,'geteuid',return_value=1000):
            with self.assertRaises(PermissionError):op.guard('target')
        with patch.object(op.os,'geteuid',return_value=0),patch.object(op.socket,'gethostname',return_value='foreign'):
            with self.assertRaises(PermissionError):op.guard('source')

    def test_target_existing_empty_queue_never_overwritten(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            target=Path(tmp)/'queue';target.mkdir()
            with patch.object(op,'TARGET',target):
                with self.assertRaises(FileExistsError):op.target_preflight()
            self.assertTrue(target.is_dir());self.assertEqual(list(target.iterdir()),[])

    def test_receive_cipher_is_bounded_hash_checked_and_exclusive(self):
        raw=b'fictional ciphertext';request={'kind':'cipher','cipher_sha256':hashlib.sha256(raw).hexdigest()}
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            with patch.object(op,'TARGET_STAGE',Path(tmp)),patch.object(op.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(raw))):
                result=op.receive(request);self.assertEqual(result['bytes'],len(raw))
            with patch.object(op,'TARGET_STAGE',Path(tmp)),patch.object(op.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(raw))):
                with self.assertRaises(FileExistsError):op.receive(request)

    def test_bad_cipher_is_not_accepted(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            with patch.object(op,'TARGET_STAGE',Path(tmp)),patch.object(op.sys,'stdin',types.SimpleNamespace(buffer=io.BytesIO(b'wrong'))):
                with self.assertRaises(ValueError):op.receive({'kind':'cipher','cipher_sha256':'0'*64})

    def test_unknown_upload_kind_cannot_choose_path(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            with patch.object(op,'TARGET_STAGE',Path(tmp)):
                for kind in ['../../foreign','unlock']:
                    with self.assertRaises(KeyError):op.receive({'kind':kind})
            self.assertEqual(list(Path(tmp).iterdir()),[])

    def test_existing_target_stage_permissions_required(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as tmp:
            stage=Path(tmp)
            with patch.object(op,'TARGET_STAGE',stage),patch.object(op.os,'geteuid',return_value=0),patch.object(op.socket,'gethostname',return_value='peticao-civo'):
                with self.assertRaises(PermissionError):op.guard('target')


if __name__=='__main__':unittest.main()
