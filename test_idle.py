import copy,json,time,unittest
from unittest.mock import patch
import idle_guard as guard
import deallocate as op

def sample():
 return {'hostname':guard.VM,'unix':1000,'monotonic':1000,'processes':[{'pid':77,'ppid':1,'comm':'python3','cwd':'/','observer_ancestor':True},{'pid':1,'ppid':0,'comm':'systemd','cwd':'/','observer_ancestor':False}],**{x:{'exit':0,'stdout':''} for x in ['sessions','who','units','jobs','containers','mounts']}}

def rows():
 r=[]
 for i in range(21):
  s=sample();s.update(unix=1000+30*i,monotonic=1000+30*i);r.append({'sample':i,'metadata':s})
 return r

class Idle(unittest.TestCase):
 def test_full_ten_minute_window(self):self.assertEqual(guard.window(rows(),now=1601)['samples'],21)
 def test_short_window_refused(self):
  r=rows();r[-1]['metadata']['monotonic']-=1
  with self.assertRaises(ValueError):guard.window(r,now=1601)
 def test_stale_refused(self):
  with self.assertRaises(ValueError):guard.window(rows(),now=2000)
 def test_gap_refused(self):
  r=rows();r[5]['metadata']['monotonic']+=20
  with self.assertRaises(ValueError):guard.window(r,now=1601)
 def test_container_refused(self):
  s=sample();s['containers']['stdout']='container active'
  with self.assertRaises(ValueError):guard.idle(s)
 def test_unknown_process_refused(self):
  s=sample();s['processes'].append({'pid':9,'ppid':1,'comm':'unknown-app','cwd':'/','observer_ancestor':False})
  with self.assertRaises(ValueError):guard.idle(s)
 def test_other_login_refused(self):
  s=sample();s['sessions']['stdout']='1 1000 builder - 900 user - no -'
  with self.assertRaises(ValueError):guard.idle(s)
 def test_own_login_and_manager_allowed(self):
  s=sample();s['sessions']['stdout']='1 1000 builder - 77 user - no -\n2 1000 builder - 95 manager - no -';self.assertTrue(guard.idle(s))
 def test_waagent_python_allowed_only_exact_path(self):
  s=sample();p={'pid':9,'ppid':1,'comm':'python3','cwd':'/var/lib/waagent/WALinuxAgent-2.16.0.2','observer_ancestor':False};s['processes'].append(p);self.assertTrue(guard.idle(s));p['cwd']='/mnt/apps/app'
  with self.assertRaises(ValueError):guard.idle(s)
 def test_running_project_service_refused(self):
  s=sample();s['units']['stdout']='peticao-azure-qualified-build-20261114-attempt1.service loaded active running work'
  with self.assertRaises(ValueError):guard.idle(s)
 def test_command_failure_not_empty_success(self):
  s=sample();s['containers']['exit']=1
  with self.assertRaises(ValueError):guard.idle(s)
 def test_other_vm_refused(self):
  with patch.object(op,'az',return_value={'id':'other','tags':{},'size':'Standard_E8ads_v7','ephemeralOS':None,'osDisk':'disk'}):
   with self.assertRaises(ValueError):op.vm()
 def test_ephemeral_os_refused(self):
  with patch.object(op,'az',return_value={'id':op.ID,'tags':{'Operation':'APOIO-AZURE-20261114'},'size':'Standard_E8ads_v7','ephemeralOS':{'option':'Local'},'osDisk':'disk'}):
   with self.assertRaises(ValueError):op.vm()
 def test_disk_or_ip_change_detected(self):
  a={k:k for k in ['id','location','size','osDisk','ephemeralOS','network','publicIps','tags']};b=copy.deepcopy(a);b['publicIps']='new';self.assertNotEqual(op.invariant(a),op.invariant(b));b=copy.deepcopy(a);b['osDisk']='new';self.assertNotEqual(op.invariant(a),op.invariant(b))
if __name__=='__main__':unittest.main()
