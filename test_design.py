import ast,copy,datetime as dt,hashlib,json,subprocess,tempfile,unittest
from pathlib import Path
from unittest.mock import patch
import contract as c
import source_probe as sp
import live_verifier as lv
ROOT=Path(__file__).resolve().parent
START='2026-11-15T00:00:00+00:00';END='2026-11-15T00:00:02+00:00';NONCE='a'*32

def ready():
 p=json.loads((ROOT/'OPERATION.template.json').read_text());p.update(status='REVIEWED_OPERATION',cutover_authorized=True,operation_id='b'*32,snapshot_id='c'*32,checkpoint_sha256='d'*64,queue_facts={'nonterminal_jobs':0,'tables':{'jobs':{'rows':0,'sha256':'e'*64}}},source_authority_uid=999,source_authority_gid=987,source_boot_id='1'*8+'-'+'1'*4+'-'+'1'*4+'-'+'1'*4+'-'+'1'*12,target_boot_id='2'*8+'-'+'2'*4+'-'+'2'*4+'-'+'2'*4+'-'+'2'*12)
 p['runtime_qualifications']={k:{'status':'PASS','manifest_event':1,'evidence_sha256':'f'*64} for k in c.GATES};return p

def proof(p):return {'previous_host':p['source_host'],'previous_generation':1,'new_generation':2,'method':'coordinator-stopped','verified':True,**{k:p[k] for k in ['operation_id','snapshot_id','checkpoint_sha256']}}

def observation(p):
 return {'nonce':NONCE,'operation_id':p['operation_id'],'source_host':p['source_host'],'generation':1,'role':'suspended','armed_boot_id':None,'source_boot_id':p['source_boot_id'],'authority_sha256':'e'*64,'manual_fence_sha256':'f'*64,'queue_facts':p['queue_facts'],'checkpoint_sha256':p['checkpoint_sha256'],'epoch_control':c.epoch_control(p),'epoch_sha256':c.epoch_digest(c.epoch_control(p)),'units':[{'unit':'admin-v2-coordinator.service','load_state':'loaded','active_state':'inactive','main_pid':0,'cgroup_processes':0}],'live_systemd_queried':True,'double_inventory_equal':True,'authority_unchanged':True,'boot_unchanged':True,'code_pins_verified':True,'observed_at_source':END}

def target(p):return {'host':p['target_host'],'boot_id':p['target_boot_id'],'role':'standby','armed_boot_id':None,'generation':1,'generation_floor':1,'source_host':p['source_host'],'snapshot_id':p['snapshot_id'],'checkpoint_sha256':p['checkpoint_sha256'],'queue_facts':p['queue_facts'],'service_active':False,'active_workers':0,'epoch_control':c.epoch_control(p)}

class Design(unittest.TestCase):
 def validate(self,p=None,o=None,pr=None):
  p=p or ready();return c.validate(pr or proof(p),NONCE,o or observation(p),p,START,END,2)
 def test_delivered_template_blocks_every_real_operation(self):
  with self.assertRaises(PermissionError):c.policy_ready(json.loads((ROOT/'OPERATION.template.json').read_text()))
 def test_fictitious_live_contract_and_memory_generation1to2(self):
  p=ready();r=self.validate(p);r=c.rehearse(target(p),r,p,p['target_boot_id']);self.assertEqual(r['candidate_floor'],2);self.assertEqual(r['candidate_authority']['generation'],2);self.assertFalse(r['runtime_files_written']);self.assertFalse(r['actual_promotion_authorized']);self.assertFalse(r['jobs_admitted'])
 def test_wrong_nonce_rejected(self):
  p=ready();o=observation(p);o['nonce']='0'*32
  with self.assertRaises(ValueError):self.validate(p,o)
 def test_stale_or_future_source_clock_rejected(self):
  for t in ['2026-11-14T23:59:00+00:00','2026-11-15T00:01:00+00:00']:
   p=ready();o=observation(p);o['observed_at_source']=t
   with self.assertRaises(ValueError):self.validate(p,o)
 def test_naive_timestamp_rejected(self):
  p=ready();o=observation(p);o['observed_at_source']='2026-11-15T00:00:02'
  with self.assertRaises(ValueError):self.validate(p,o)
 def test_transport_late_fails(self):
  p=ready()
  with self.assertRaises(ValueError):c.validate(proof(p),NONCE,observation(p),p,START,END,21)
 def test_missing_live_flags_not_relabelled_static_receipt(self):
  for k in ['live_systemd_queried','double_inventory_equal','authority_unchanged','boot_unchanged','code_pins_verified']:
   p=ready();o=observation(p);o[k]=False
   with self.assertRaises(ValueError):self.validate(p,o)
 def test_unknown_unit_not_fenced(self):
  p=ready();o=observation(p);o['units'][0]['load_state']='not-found'
  with self.assertRaises(ValueError):self.validate(p,o)
 def test_running_pid_or_cgroup_blocks(self):
  for k,v in [('active_state','running'),('main_pid',4),('cgroup_processes',1)]:
   p=ready();o=observation(p);o['units'][0][k]=v
   with self.assertRaises(ValueError):self.validate(p,o)
 def test_source_primary_armed_or_reboot_blocks(self):
  for k,v in [('role','primary'),('armed_boot_id','oldboot'),('source_boot_id','3'*36)]:
   p=ready();o=observation(p);o[k]=v
   with self.assertRaises(ValueError):self.validate(p,o)
 def test_changed_queue_checkpoint_and_operation_block(self):
  for k,v in [('queue_facts',{'nonterminal_jobs':1}),('checkpoint_sha256','0'*64),('operation_id','0'*32)]:
   p=ready();o=observation(p);o[k]=v
   with self.assertRaises(ValueError):self.validate(p,o)
 def test_foreign_or_boolean_generation_proof_blocks(self):
  for k,v in [('previous_host','peticao-sp'),('previous_generation',True),('new_generation',3),('verified',1),('method','provider-powered-off')]:
   p=ready();pr=proof(p);pr[k]=v
   with self.assertRaises(ValueError):self.validate(p,pr=pr)
 def test_all_runtime_gates_are_mandatory(self):
  for k in c.GATES:
   p=ready();p['runtime_qualifications'][k]=None
   with self.assertRaises(PermissionError):c.policy_ready(p)
 def test_bad_target_floor_boot_and_primary_block(self):
  for k,v in [('generation_floor',2),('boot_id','changed'),('role','primary'),('generation',True),('service_active',True)]:
   p=ready();t=target(p);t[k]=v
   with self.assertRaises(ValueError):c.target_ready(t,p)
 def test_partial_three_write_states_are_not_replayed(self):
  self.assertIn('never-decrement',c.classify_write_outcome(2,1,'standby',False));self.assertIn('never-replay',c.classify_write_outcome(2,2,'primary',False));self.assertIn('no-automatic-service-start',c.classify_write_outcome(2,2,'primary',True))
 def test_shared_epoch_schema_digest_and_rearm_boot_guard(self):
  p=ready();control=c.epoch_control(p)
  self.assertEqual(set(control),{'generation','primary_host','coordinator_boot_id','operation_id'})
  self.assertEqual(control['primary_host'],'civo')
  expected=hashlib.sha256(json.dumps(control,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest();self.assertEqual(c.epoch_digest(control),expected)
  a={'role':'primary','generation':2,'armed_boot_id':p['target_boot_id']}
  self.assertTrue(c.primary_allowed(a,control,'civo',p['target_boot_id'],p['operation_id']))
  self.assertFalse(c.primary_allowed(a,control,'santiago',p['target_boot_id'],p['operation_id']))
  self.assertFalse(c.primary_allowed(a,control,'civo','new-boot',p['operation_id']))
  self.assertFalse(c.primary_allowed(a,control,'civo',p['target_boot_id'],'0'*32))
 def test_stale_or_mismatched_distributed_guard_refused(self):
  for k,v in [('generation',1),('primary_host','santiago'),('coordinator_boot_id','old-boot'),('operation_id','0'*32)]:
   p=ready();o=observation(p);o['epoch_control'][k]=v;o['epoch_sha256']=c.epoch_digest(o['epoch_control'])
   with self.assertRaises(ValueError):self.validate(p,o)
 def test_installed_module_and_host_pins_are_frozen(self):
  for name,expected in [('contract.py',lv.EXPECTED_CONTRACT_SHA),('source_probe.py',lv.EXPECTED_PROBE_SHA),('known_hosts',lv.EXPECTED_KNOWN_SHA)]:self.assertEqual(hashlib.sha256((ROOT/name).read_bytes()).hexdigest(),expected)
 def test_probe_cannot_stop_systemd(self):
  with patch.object(sp.subprocess,'run') as run:
   with self.assertRaises(PermissionError):sp.command(['stop','admin-v2-coordinator.service'])
   run.assert_not_called()
 def test_probe_early_host_guard_no_reads(self):
  with patch.object(sp.os,'geteuid',return_value=1000),patch.object(sp,'file_bytes') as read:
   with self.assertRaises(PermissionError):sp.observe({})
   read.assert_not_called()
 def test_verifier_early_root_guard_no_network_or_files(self):
  with patch.object(lv.os,'geteuid',return_value=1000),patch.object(lv,'module') as read,patch.object(lv.subprocess,'run') as run:
   with self.assertRaises(PermissionError):lv.main()
   read.assert_not_called();run.assert_not_called()
 def test_pinned_ssh_no_mux_or_password(self):
  args=lv.ssh_command('print("fictitious")');text=' '.join(args)
  for value in ['StrictHostKeyChecking=yes','UpdateHostKeys=no','BatchMode=yes','IdentitiesOnly=yes','ControlPath=none','HostKeyAlias=[sonda-verifica3.tail1a6d71.ts.net]:2224','root@100.80.18.81']:self.assertIn(value,text)
  self.assertNotIn('100.109.6.122',text);self.assertNotIn('accept-new',text)
 def test_cgroup_real_fixture_metadata_empty_or_populated(self):
  work=ROOT.parent/'test-work';work.mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(dir=work) as d:
   p=Path(d)/'unit';p.mkdir();(p/'cgroup.procs').write_text('');(p/'cgroup.events').write_text('populated 0\nfrozen 0\n');self.assertEqual(sp.cgroup_count('/unit',Path(d)),0)
   (p/'cgroup.procs').write_text('123\n');(p/'cgroup.events').write_text('populated 1\n')
   with self.assertRaises(ValueError):sp.cgroup_count('/unit',Path(d))
 def test_real_legacy_source_custody_and_contract_ast_only(self):
  pins=json.loads((ROOT/'SOURCE-CUSTODY.json').read_text())['sha256']
  for name,expected in pins.items():self.assertEqual(hashlib.sha256((ROOT/'legacy'/name).read_bytes()).hexdigest(),expected)
  raw=(ROOT/'legacy/recovery.py').read_text();tree=ast.parse(raw);f=next(x for x in tree.body if isinstance(x,ast.FunctionDef) and x.name=='_promote');body=ast.get_source_segment(raw,f)
  for text in ['ADMIN_CLUSTER_FENCE_NONCE','0 <= age <= 60','new_generation = generation + 1','requires_operator_service_start']:self.assertIn(text,body)
  # Never invoke legacy promote/main; AST establishes current real contract only.
if __name__=='__main__':unittest.main()
