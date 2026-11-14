import json,time,tempfile,unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import toolchain_operator as op

class GatedToolchain(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(dir=op.SOURCE.parent);self.addCleanup(self.temp.cleanup)
  self.state=Path(self.temp.name);p=patch.object(op,'STATE',self.state);p.start();self.addCleanup(p.stop)
  self.args=SimpleNamespace(phase='install',manifest_event=1)
  self.policy={'vm_id':'fixture','public_ipv4':'203.0.113.1'}
  self.cap={'live_expires':time.time()+3600,'fence':1}
  self.vm={'id':'fixture','publicIps':'203.0.113.1','tags':{'Operation':'APOIO-AZURE-20261114'},'hardwareProfile':{'vmSize':'Standard_E8ads_v7'},'provisioningState':'Succeeded'}
 def api(self):return SimpleNamespace(returncode=0,stdout=json.dumps(self.vm))
 def test_expired_lease_blocks_every_remote_call(self):
  with patch.object(op,'gate',side_effect=RuntimeError('expired')),patch.object(op.subprocess,'run') as run:
   with self.assertRaisesRegex(RuntimeError,'expired'):op.gate_ssh(self.args,'fixture')
   run.assert_not_called()
 def test_phase_budget_refuses_before_api_or_intent(self):
  with patch.object(op,'gate',return_value=(self.policy,dict(self.cap,live_expires=time.time()+301),{})),patch.object(op.subprocess,'run') as run:
   with self.assertRaisesRegex(RuntimeError,'budget'):op.gate_ssh(self.args,'fixture',timeout=900)
   run.assert_not_called();self.assertFalse((self.state/'install.intent.json').exists())
 def test_wrong_owned_vm_refuses_before_ssh(self):
  self.vm['publicIps']='203.0.113.2'
  with patch.object(op,'gate',return_value=(self.policy,self.cap,{})),patch.object(op.subprocess,'run',return_value=self.api()) as run:
   with self.assertRaisesRegex(RuntimeError,'wrong_vm'):op.gate_ssh(self.args,'fixture')
   self.assertEqual(run.call_count,1)
 def test_pending_intent_blocks_replay(self):
  op.save(self.state/'install.intent.json',{'state':'pending'},exclusive=True)
  with patch.object(op,'gate',return_value=(self.policy,self.cap,{})),patch.object(op.subprocess,'run',return_value=self.api()) as run:
   with self.assertRaisesRegex(RuntimeError,'no_retry'):op.gate_ssh(self.args,'fixture')
   self.assertEqual(run.call_count,1)
 def test_timeout_stays_pending_no_blind_retry(self):
  with patch.object(op,'gate',return_value=(self.policy,self.cap,{})),patch.object(op.subprocess,'run',side_effect=[self.api(),TimeoutError(),self.api()]) as run:
   with self.assertRaises(TimeoutError):op.gate_ssh(self.args,'fixture')
   self.assertEqual(json.loads((self.state/'install.intent.json').read_text())['state'],'pending')
   with self.assertRaisesRegex(RuntimeError,'no_retry'):op.gate_ssh(self.args,'fixture')
   self.assertEqual(run.call_count,3)
if __name__=='__main__':unittest.main()
