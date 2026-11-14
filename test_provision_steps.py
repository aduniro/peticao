from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from provision_steps import perform_step,request_for,RULES,HOSTNAME


class Api:
    def __init__(self):self.calls=[]
    def request(self,method,path,**kwargs):
        self.calls.append((method,path,kwargs))
        return {'id':'00000000-0000-4000-8000-'+str(len(self.calls)).zfill(12)}


class ExactProvisioning(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.api=Api();self.gates=[]
    def step(self,name,**kwargs):return perform_step(name,self.root,self.api,self.gates.append,**kwargs)
    def prerequisites(self):
        self.step('ssh-key',public_key='ssh-ed25519 TEST-ONLY-PUBLIC-KEY')
        self.step('firewall')
        for name in RULES:self.step('rule-'+name)
    def test_missing_firewall_rules_cannot_start_vm(self):
        self.step('ssh-key',public_key='ssh-ed25519 TEST-ONLY-PUBLIC-KEY');self.step('firewall')
        with self.assertRaises(FileNotFoundError):self.step('instance')
        self.assertEqual(len(self.api.calls),2)
    def test_billing_requires_real_readiness_before_post(self):
        self.prerequisites()
        with self.assertRaises(ValueError):self.step('instance')
        self.assertEqual(len(self.api.calls),6)
    def test_exact_requests_cannot_enable_gpu_or_public_ssh(self):
        self.prerequisites()
        with patch('provision_steps.require_ready'):
            self.step('instance');self.step('volume')
        requests=[x[2]['payload'] for x in self.api.calls]
        vm=requests[-2];volume=requests[-1]
        self.assertEqual(vm['size'],'g4c.medium');self.assertEqual(vm['count'],1)
        self.assertEqual(vm['hostname'],HOSTNAME);self.assertNotIn('script',vm)
        self.assertEqual(volume['size_gb'],200)
        tcp_ingress=[x for x in requests if x.get('protocol')=='tcp' and x.get('direction')=='ingress']
        self.assertEqual([x['cidr'] for x in tcp_ingress],['172.235.145.216/32'])
    def test_private_key_is_never_uploaded_as_public_key(self):
        with self.assertRaises(ValueError):self.step('ssh-key',public_key='-----BEGIN PRIVATE KEY-----')
        self.assertEqual(self.api.calls,[])
    def test_arbitrary_new_resource_step_is_rejected(self):
        with self.assertRaises(ValueError):self.step('gpu')
        self.assertEqual(self.api.calls,[])


if __name__=='__main__':unittest.main()
