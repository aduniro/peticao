import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('civo_stage_client',ROOT/'client.py')
client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)


class ClientTests(unittest.TestCase):
    def test_apply_requires_capability_before_ssh(self):
        with patch.object(client,'reviewed'),patch.object(client,'packet',return_value={}),patch.object(client.subprocess,'run') as run:
            with self.assertRaises(PermissionError):client.execute('apply',Path('/not-created'),1)
            run.assert_not_called()

    def test_foreign_session_or_public_capability_refused(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as folder:
            path=Path(folder)/'cap';path.write_text(json.dumps({'operator_session':'other','result':{}}));path.chmod(0o600)
            with patch.object(client,'central') as central:
                with self.assertRaises(PermissionError):client.validate_lease(path,1)
                central.assert_not_called()
                path.chmod(0o644)
                with self.assertRaises(PermissionError):client.validate_lease(path,1)

    def test_non_applied_action_not_exposed(self):
        with patch.object(client,'reviewed'),patch.object(client,'packet',return_value={}):
            with self.assertRaises(ValueError):client.execute('rollback',Path('/not-created'),1)

    def test_no_ssh_if_evidence_exists(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as folder:
            path=Path(folder)/'receipt';path.write_text('preserve')
            with patch.object(client,'reviewed'),patch.object(client,'packet',return_value={}),patch.object(client.subprocess,'run') as run:
                with self.assertRaises(FileExistsError):client.execute('preflight',path,1)
                run.assert_not_called()
            self.assertEqual(path.read_text(),'preserve')

    def test_frozen_packet_includes_exact_live_modules_and_guard(self):
        with patch.object(client,'git',side_effect=['','a'*40]):packet=client.packet()
        self.assertEqual(len(packet['runtime']),8)
        custody=json.loads((ROOT/'SOURCE-CUSTODY.json').read_text())
        for name,rec in custody['installed'].items():
            self.assertEqual(packet['hashes'][name],rec['sha256'])

    def test_expiring_or_wrong_operation_lease_refused(self):
        with tempfile.TemporaryDirectory(dir=ROOT/'test-work') as folder:
            path=Path(folder)/'cap';path.write_text(json.dumps({'operator_session':client.SESSION,'result':{'lease':'own','token':'fictional','fence':1,'seq':2}}));path.chmod(0o600)
            for operation,expires in [('edit',99999999999),('deploy',0)]:
                lease={'id':'own','actor':'admin-recuperacao','operation':operation,'resources':[client.RESOURCE],'expires':expires}
                with patch.object(client,'central',side_effect=[{}, {'leases':[lease]}]):
                    with self.assertRaises(PermissionError):client.validate_lease(path,3)

    def test_review_requires_independent_ack_even_after_hash_match(self):
        notice={'seq':3,'kind':'notice','data':{'manifest':{'commit':'a'*40},'file_sha256':{'file':'hash'}}}
        with patch.object(client,'git',side_effect=['','a'*40]),patch.object(client,'source_hashes',return_value={'file':'hash'}),patch.object(client,'central',side_effect=[[notice],[]]):
            with self.assertRaises(PermissionError):client.reviewed(3)

    def test_ack_is_found_across_paginated_history(self):
        notice={'seq':3,'kind':'notice','data':{'manifest':{'commit':'a'*40},'file_sha256':{}}}
        first=[{'seq':i,'kind':'observation','actor':'apoio','data':{}} for i in range(4,204)]
        second=[{'seq':204,'kind':'ack','actor':'apoio','data':{'event_seq':3}}]
        with patch.object(client,'git',side_effect=['','a'*40]),patch.object(client,'source_hashes',return_value={}),patch.object(client,'central',side_effect=[[notice],first,second]):
            self.assertEqual(client.reviewed(3),notice['data'])


if __name__=='__main__':unittest.main()
