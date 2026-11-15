"""Pure DEV fencing contracts and in-memory generation rehearsal; no I/O effects."""
import datetime as dt
import re
import hashlib,json

GATES=('bootstrap_authority','source_rearm_guard','gateway_topology','launcher_identity','worker_runtime','job_admission','canonical_executor')

def aware(value):
 t=dt.datetime.fromisoformat(value)
 if t.tzinfo is None:raise ValueError('timezone required')
 return t

def policy_ready(policy):
 if policy.get('status')!='REVIEWED_OPERATION' or policy.get('cutover_authorized') is not True:raise PermissionError('prepared design is not cutover authorization')
 if policy.get('source_node')!='santiago' or policy.get('target_node')!='civo' or policy.get('epoch_guard_path')!='/etc/peticao-dev-authority/epoch.json':raise ValueError('fixed logical DEV nodes/guard required')
 if policy.get('source_host')!='sonda-verifica3' or policy.get('target_host')!='peticao-civo' or policy.get('source_address')!='100.80.18.81' or policy.get('source_dns')!='sonda-verifica3.tail1a6d71.ts.net' or policy.get('source_port')!=2224:raise ValueError('fixed DEV endpoints only')
 if type(policy.get('previous_generation')) is not int or policy['previous_generation']!=1 or type(policy.get('new_generation')) is not int or policy['new_generation']!=2:raise ValueError('exact generation1 to2 required')
 for name in ['source_boot_id','target_boot_id']:
  if not isinstance(policy.get(name),str) or not re.fullmatch('[a-f0-9-]{36}',policy[name]):raise ValueError('actual boot identity required')
 if type(policy.get('source_authority_uid')) is not int or type(policy.get('source_authority_gid')) is not int:raise ValueError('actual source ownership required')
 for name in ['operation_id','snapshot_id']:
  if not isinstance(policy.get(name),str) or not re.fullmatch('[a-f0-9]{32}',policy[name]):raise ValueError('fixed operation/snapshot identity required')
 if not isinstance(policy.get('checkpoint_sha256'),str) or not re.fullmatch('[a-f0-9]{64}',policy['checkpoint_sha256']):raise ValueError('actual checkpoint pin required')
 facts=policy.get('queue_facts')
 if not isinstance(facts,dict) or type(facts.get('nonterminal_jobs')) is not int or facts.get('nonterminal_jobs')!=0:raise ValueError('qualified terminal queue baseline required')
 for name in GATES:
  item=policy.get('runtime_qualifications',{}).get(name)
  if not isinstance(item,dict) or item.get('status')!='PASS' or type(item.get('manifest_event')) is not int or item['manifest_event']<1 or not re.fullmatch('[a-f0-9]{64}',item.get('evidence_sha256','')):raise PermissionError('unqualified dependency:'+name)
 return True


def epoch_control(policy):
 return {'generation':policy['new_generation'],'primary_host':policy['target_node'],'coordinator_boot_id':policy['target_boot_id'],'operation_id':policy['operation_id']}

def epoch_digest(value):
 return hashlib.sha256(json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False).encode()).hexdigest()

def check_epoch_control(value,policy):
 if set(value)!={'generation','primary_host','coordinator_boot_id','operation_id'} or type(value.get('generation')) is not int or value!=epoch_control(policy):raise ValueError('durable epoch owner/boot/operation differs')
 return epoch_digest(value)

def primary_allowed(authority,control,host,boot,operation_id):
 return (set(control)=={'generation','primary_host','coordinator_boot_id','operation_id'} and type(control.get('generation')) is int and type(authority.get('generation')) is int and authority.get('role')=='primary' and authority.get('armed_boot_id')==boot and authority.get('generation')==control['generation'] and host==control['primary_host'] and boot==control['coordinator_boot_id'] and operation_id==control['operation_id'])

def validate(proof,nonce,observation,policy,started_at,received_at,elapsed):
 policy_ready(policy)
 if not re.fullmatch('[a-f0-9]{32}',nonce or ''):raise ValueError('fresh challenge nonce required')
 if elapsed<0 or elapsed>20:raise ValueError('transport freshness bound exceeded')
 start,end=aware(started_at),aware(received_at)
 if end<start or (end-start).total_seconds()>25:raise ValueError('invalid verifier interval')
 for key,expected in [('previous_host',policy['source_host']),('previous_generation',1),('new_generation',2),('method','coordinator-stopped'),('verified',True)]:
  if proof.get(key)!=expected or (key.endswith('generation') and type(proof[key]) is not int):raise ValueError('proof scope mismatch:'+key)
 if proof.get('verified') is not True:raise ValueError('boolean verified intent required, never sufficient alone')
 for name in ['operation_id','snapshot_id','checkpoint_sha256']:
  if proof.get(name)!=policy[name]:raise ValueError('proof is from another checkpoint/operation')
 if observation.get('nonce')!=nonce or observation.get('operation_id')!=policy['operation_id'] or observation.get('source_host')!=policy['source_host'] or observation.get('generation')!=1 or type(observation.get('generation')) is not int:raise ValueError('live source challenge mismatch')
 expected_epoch=check_epoch_control(observation.get('epoch_control',{}),policy)
 if observation.get('epoch_sha256')!=expected_epoch:raise ValueError('source epoch digest mismatch')
 if observation.get('source_boot_id')!=policy['source_boot_id']:raise ValueError('source rebooted since reviewed operation')
 if observation.get('role')!='suspended' or observation.get('armed_boot_id') is not None:raise ValueError('old authority still armed')
 if any(observation.get(k) is not True for k in ['live_systemd_queried','double_inventory_equal','authority_unchanged','boot_unchanged','code_pins_verified']):raise ValueError('live consistency proof missing')
 for name in ['authority_sha256','manual_fence_sha256']:
  if not re.fullmatch('[a-f0-9]{64}',observation.get(name,'')):raise ValueError('actual source receipt hashes required')
 if observation.get('queue_facts')!=policy['queue_facts'] or observation.get('checkpoint_sha256')!=policy['checkpoint_sha256']:raise ValueError('checkpoint differs from final queue')
 seen=set()
 for unit in observation.get('units',[]):
  name=unit.get('unit','')
  if name!='admin-v2-coordinator.service' and not re.fullmatch('admin-v2-job-[a-fA-F0-9-]{32,36}\\.service',name):raise ValueError('unexpected unit')
  if name in seen:raise ValueError('duplicate unit')
  seen.add(name)
  if unit.get('load_state')!='loaded' or unit.get('active_state') not in {'inactive','failed'} or unit.get('main_pid')!=0 or type(unit.get('main_pid')) is not int or unit.get('cgroup_processes')!=0 or type(unit.get('cgroup_processes')) is not int:raise ValueError('unknown or live unit is not fenced')
 if 'admin-v2-coordinator.service' not in seen:raise ValueError('coordinator unit proof required')
 observed=aware(observation['observed_at_source'])
 if observed<start-dt.timedelta(seconds=5) or observed>end+dt.timedelta(seconds=5):raise ValueError('source evidence stale or clocks inconsistent')
 return {'confirmed':True,'nonce':nonce,'previous_host':policy['source_host'],'previous_generation':1,'new_generation':2,'method':'coordinator-stopped','verified_at':received_at,'source_observed_at':observation['observed_at_source'],'operation_id':policy['operation_id'],'checkpoint_sha256':policy['checkpoint_sha256'],'source_boot_id':observation['source_boot_id'],'source_authority_sha256':observation['authority_sha256'],'source_manual_fence_sha256':observation['manual_fence_sha256'],'units':observation['units'],'epoch_sha256':expected_epoch,'coordinator_host':policy['target_node'],'coordinator_boot_id':policy['target_boot_id'],'authority_operation_id':policy['operation_id'],'live_ssh':True,'provider_power_state_inferred':False}

def target_ready(target,policy):
 policy_ready(policy)
 check_epoch_control(target.get('epoch_control',{}),policy)
 if target.get('boot_id')!=policy['target_boot_id']:raise ValueError('target boot changed')
 if target.get('host')!=policy['target_host'] or target.get('role') not in {'standby','suspended'} or target.get('armed_boot_id') is not None or target.get('generation')!=1 or type(target.get('generation')) is not int or target.get('generation_floor')!=1 or type(target.get('generation_floor')) is not int:raise ValueError('target active/stale/divergent')
 if target.get('source_host')!=policy['source_host'] or target.get('snapshot_id')!=policy['snapshot_id'] or target.get('checkpoint_sha256')!=policy['checkpoint_sha256'] or target.get('queue_facts')!=policy['queue_facts']:raise ValueError('target recovery custody differs')
 if target.get('service_active') is not False or type(target.get('active_workers')) is not int or target.get('active_workers')!=0:raise ValueError('target must remain passive')
 return True

def rehearse(target,confirmation,policy,target_boot):
 target_ready(target,policy)
 if target_boot!=policy['target_boot_id']:raise ValueError('target boot mismatch')
 if confirmation.get('confirmed') is not True or confirmation.get('new_generation')!=2 or confirmation.get('operation_id')!=policy['operation_id']:raise ValueError('confirmed same operation required')
 return {'simulation_only':True,'runtime_files_written':False,'candidate_authority':{'role':'primary','generation':2,'armed_boot_id':target_boot},'candidate_floor':2,'jobs_admitted':False,'services_started':False,'actual_promotion_authorized':False}

def classify_write_outcome(floor,generation,role,receipt):
 if floor==1 and generation==1 and role in {'standby','suspended'}:return 'unchanged-observe-before-any-action'
 if floor==2 and generation==1:return 'floor-advanced-authority-old-stop-and-reconcile-never-decrement'
 if floor==2 and generation==2 and role=='primary' and not receipt:return 'authority-may-be-primary-receipt-missing-never-replay'
 if floor==2 and generation==2 and role=='primary' and receipt:return 'generation2-observe-boot-and-runtime-gates-no-automatic-service-start'
 return 'contradiction-stop-and-reconcile'
