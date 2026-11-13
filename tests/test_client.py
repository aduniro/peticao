import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('standby_client',ROOT/'client.py')
client=importlib.util.module_from_spec(spec);spec.loader.exec_module(client)
spec=importlib.util.spec_from_file_location('temporary_test_ledger',client.LEDGER_SOURCE)
coord=importlib.util.module_from_spec(spec);spec.loader.exec_module(coord)


class ClientTests(unittest.TestCase):
    def setUp(self):
        t=tempfile.TemporaryDirectory();self.addCleanup(t.cleanup);self.root=Path(t.name)
        self.central=coord.Ledger(self.root/'coord.sqlite')
        for actor in ['admin-recuperacao','apoio','executor61']:
            self.central.register(actor,'synthetic-session-'+actor,[])
        self.packet={'commit':'a'*40}
        self.packet_path=self.root/'packet.json';self.packet_path.write_text(json.dumps(self.packet))
        manifest={'commit':self.packet['commit'],'files':['client.py','operator.py'],
                  'tests':['isolated fixture tests'],'api_contracts':'no change',
                  'database':'no database touched','destination':'synthetic target'}
        self.notice=self.central.announce('admin-recuperacao','synthetic standby test',[client.RESOURCE],
                      {'manifest':manifest,'packet_sha256':client.digest(self.packet_path.read_bytes())})['seq']
        self.central.ack('apoio',self.notice);self.central.ack('executor61',self.notice)

    def lease(self,operation='deploy',resource=None):
        r=self.central.acquire('admin-recuperacao',[resource or client.RESOURCE],operation,600,
                               self.notice if operation=='deploy' else None)
        p=self.root/'lease.private.json'
        p.write_text(json.dumps({'operator_session':client.SESSION,'result':r}));p.chmod(0o600)
        return p,r

    def test_actual_temporary_ledger_accepts_only_exact_own_critical_scope(self):
        p,r=self.lease()
        result=client.own_lease(p,self.packet_path,self.packet,self.central)
        self.assertEqual(result['fence'],r['fence'])
        self.assertNotIn('token',result)

    def test_root_or_other_session_record_is_refused(self):
        p,_=self.lease();d=json.loads(p.read_text());d.pop('operator_session');p.write_text(json.dumps(d))
        with self.assertRaises(PermissionError):client.own_lease(p,self.packet_path,self.packet,self.central)

    def test_edit_operation_is_not_a_deploy_bypass(self):
        p,_=self.lease('edit')
        with self.assertRaises(PermissionError):client.own_lease(p,self.packet_path,self.packet,self.central)

    def test_different_deploy_resource_is_refused(self):
        p,_=self.lease('deploy','deploy:other-synthetic-scope')
        with self.assertRaises(PermissionError):client.own_lease(p,self.packet_path,self.packet,self.central)

    def test_manifest_bound_to_another_packet_is_refused(self):
        p,_=self.lease();self.packet_path.write_text(json.dumps({'commit':'a'*40,'changed':True}))
        with self.assertRaises(ValueError):client.own_lease(p,self.packet_path,self.packet,self.central)

    def test_released_lease_cannot_be_reused(self):
        p,r=self.lease();self.central.release('admin-recuperacao',r['lease'],r['token'],r['fence'])
        with self.assertRaises(RuntimeError):client.own_lease(p,self.packet_path,self.packet,self.central)

    def test_world_readable_lease_record_is_refused(self):
        p,_=self.lease();p.chmod(0o644)
        with self.assertRaises(PermissionError):client.own_lease(p,self.packet_path,self.packet,self.central)

    def test_missing_deploy_lease_never_contacts_ssh(self):
        with patch.object(client,'validate_packet',return_value=self.packet),patch.object(client.subprocess,'run') as ssh:
            with self.assertRaises(PermissionError):client.execute('apply',self.packet_path,self.root/'result.json')
            ssh.assert_not_called()

    def test_existing_receipt_never_runs_external_action(self):
        result=self.root/'result.json';result.write_text('keep')
        with patch.object(client,'validate_packet',return_value=self.packet),patch.object(client.subprocess,'run') as ssh:
            with self.assertRaises(FileExistsError):client.execute('preflight',self.packet_path,result)
            ssh.assert_not_called()
        self.assertEqual(result.read_text(),'keep')

    def test_uncertain_transport_is_not_automatically_retried(self):
        out=self.root/'result.json'
        with patch.object(client,'validate_packet',return_value=self.packet),patch.object(client.subprocess,'run',side_effect=subprocess.TimeoutExpired('ssh',60)) as ssh:
            result=client.execute('preflight',self.packet_path,out)
            self.assertTrue(result['transport_uncertain'])
            self.assertEqual(ssh.call_count,1)
        self.assertFalse(json.loads(out.read_text())['automatic_retry'])


if __name__=='__main__':unittest.main()
