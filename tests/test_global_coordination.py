import copy
import importlib.util
from pathlib import Path
import tempfile
import threading
import unittest

SPEC=importlib.util.spec_from_file_location('global_coordination_fixture',Path(__file__).resolve().parents[1]/'executor/global_coordination.py')
g=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(g)


class Authority:
    def __init__(self):self.active=True;self.fence=9
    def __call__(self,lease,parent):
        return {'valid':self.active and lease=='fixture-lease','coordinator':'ADMIN','fence':self.fence,'lease_id':'fixture-lease-id'}


class Bridge:
    def __init__(self):
        self.conditions={};self.submissions=[];self.effect_ids=set();self.outcome='accepted';self.poll_result='completed';self.before_submit=None
    def probe(self,route):
        reason=self.conditions.get(route)
        return {'ready':reason is None,'target_exists':True,'target_id':route+'-fixture-thread','exclusive':True,'state':'idle' if reason is None else 'blocked','provider':'fixture','model':'fixture-model','reason':reason}
    def submit(self,route,child,instruction,metadata):
        if child in self.effect_ids:raise AssertionError('duplicate_external_effect')
        self.effect_ids.add(child);self.submissions.append({'route':route,'child':child,'instruction':instruction,'metadata':metadata})
        if self.before_submit:self.before_submit()
        if self.outcome=='timeout':raise TimeoutError('fixture_lost_after_effect')
        if self.outcome=='crash':raise SystemExit('fixture_process_death')
        return {'state':'accepted','receipt':'receipt-'+child}
    def poll(self,route,receipt):
        return {'state':self.poll_result,'receipt':'wrong-receipt' if self.poll_result=='mismatch' else receipt,'summary':'Fixture result for '+route}


class GlobalTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(dir='/dev/shm');self.path=Path(self.tmp.name)/'global.sqlite'
        self.registry={route:{'target_id':route+'-fixture-thread','provider':'fixture','model':'fixture-model'} for route in ['ADMIN','PAGINA']}
        self.authority=Authority();self.bridge=Bridge();self.authorizations=[]
        self.coordinator=self.make()
        self.plan=[{'task_id':'admin-task','route':'ADMIN','responsibility':'Validate administrative contracts','instruction':'Review administrative contracts only.','effect_key':'fixture-admin-effect','resources':['code:admin/contracts'],'dependencies':[]},{'task_id':'homepage-task','route':'PAGINA','responsibility':'Validate public form selectors','instruction':'Review public form selectors only.','effect_key':'fixture-homepage-effect','resources':['code:homepage/selectors'],'dependencies':[]}]
    def tearDown(self):self.tmp.cleanup()
    def authorize(self,action,payload,proof):
        self.authorizations.append((action,payload));return proof=='fixture-auth'
    def make(self):return g.GlobalCoordinator(self.path,self.registry,authority=self.authority,authorizer=self.authorize,adapter=self.bridge)
    def parent(self,name='fixture-parent'):
        return self.coordinator.record_parent(name,'a'*64,'owner-approved-'+name,proof='fixture-auth',lease='fixture-lease')
    def ready(self):
        self.parent();return self.coordinator.install_plan('fixture-parent',self.plan,proof='fixture-auth',lease='fixture-lease')
    def dispatch(self):return self.coordinator.dispatch_once('fixture-parent',lease='fixture-lease')
    def poll(self):return self.coordinator.poll_once('fixture-parent',lease='fixture-lease')

    def test_default_callbacks_deny_and_no_implicit_fanout(self):
        disabled=g.GlobalCoordinator(Path(self.tmp.name)/'disabled.sqlite',self.registry)
        with self.assertRaises(PermissionError):disabled.record_parent('fixture','a'*64,'approved',proof=True,lease={})
        self.assertEqual(self.parent()['state'],'needs_plan')
        self.assertEqual(self.bridge.submissions,[])
        with self.assertRaises(PermissionError):self.coordinator.install_plan('fixture-parent',self.plan,proof=True,lease='fixture-lease')

    def test_parent_plan_and_children_idempotent_exact_authorized_contract(self):
        one=self.ready();two=self.coordinator.install_plan('fixture-parent',list(reversed(self.plan)),proof='fixture-auth',lease='fixture-lease')
        self.assertEqual(one['plan_hash'],two['plan_hash']);self.assertEqual(one['children'],two['children'])
        self.assertEqual(len(one['children']),2)
        self.assertNotIn('instruction',one['children'][0])
        changed=copy.deepcopy(self.plan);changed[0]['instruction']='Changed command'
        with self.assertRaises(ValueError):self.coordinator.install_plan('fixture-parent',changed,proof='fixture-auth',lease='fixture-lease')
        with self.assertRaises(ValueError):self.coordinator.record_parent('fixture-parent','b'*64,'owner-approved-fixture-parent',proof='fixture-auth',lease='fixture-lease')
        self.assertEqual(self.authorizations[-1][0],'parent')

    def test_plan_refuses_duplicate_effect_instruction_resources_unknown_or_cycle(self):
        self.parent()
        cases=[]
        for field,value in [('instruction',self.plan[0]['instruction']),('effect_key',self.plan[0]['effect_key']),('responsibility',self.plan[0]['responsibility']),('resources',['code:admin/contracts/nested']),('route','arbitrary-target')]:
            plan=copy.deepcopy(self.plan);plan[1][field]=value;cases.append(plan)
        plan=copy.deepcopy(self.plan);plan[0]['dependencies']=['homepage-task'];plan[1]['dependencies']=['admin-task'];cases.append(plan)
        for plan in cases:
            with self.assertRaises(ValueError):self.coordinator.install_plan('fixture-parent',plan,proof='fixture-auth',lease='fixture-lease')
        self.assertEqual(self.coordinator.status('fixture-parent')['children'],[])

    def test_two_fronts_busy_restart_resume_and_correlated_summary(self):
        self.ready();self.bridge.conditions['PAGINA']='session_busy'
        self.assertEqual(self.dispatch()['state'],'running')
        self.assertEqual(self.dispatch()['reason'],'session_busy')
        self.coordinator=self.make();self.coordinator.recover('fixture-parent',lease='fixture-lease')
        self.assertEqual(len(self.bridge.submissions),1)
        self.poll();self.bridge.conditions.clear();self.dispatch();self.poll()
        state=self.coordinator.status('fixture-parent')
        self.assertEqual(state['state'],'completed');self.assertEqual(len(self.bridge.submissions),2)
        self.assertEqual({x['route'] for x in self.bridge.submissions},{'ADMIN','PAGINA'})
        self.assertNotEqual(self.bridge.submissions[0]['instruction'],self.bridge.submissions[1]['instruction'])
        self.assertTrue(all(x['summary'].startswith('Fixture result') for x in state['children']))
        self.assertIsNone(self.dispatch())

    def test_pause_safety_and_limits_never_dispatch(self):
        self.ready()
        for reason in ['session_paused','safety_blocked','limits_exhausted']:
            self.bridge.conditions.update({route:reason for route in self.registry})
            self.assertEqual(self.dispatch()['reason'],reason)
        self.assertEqual(self.bridge.submissions,[])

    def test_expired_authority_readonly_status_but_all_mutations_refused(self):
        self.ready();self.dispatch();self.authority.active=False
        before=self.coordinator.status('fixture-parent')
        for operation in [self.dispatch,self.poll,lambda:self.coordinator.recover('fixture-parent',lease='fixture-lease'),lambda:self.coordinator.install_plan('fixture-parent',self.plan,proof='fixture-auth',lease='fixture-lease')]:
            with self.assertRaises(PermissionError):operation()
        self.assertEqual(before,self.coordinator.status('fixture-parent'))
        self.assertEqual(len(self.bridge.submissions),1)

    def test_stale_fence_refused_without_local_takeover(self):
        self.ready();self.authority.fence=12;self.coordinator.recover('fixture-parent',lease='fixture-lease')
        self.authority.fence=11
        with self.assertRaises(PermissionError):self.dispatch()
        self.assertEqual(self.bridge.submissions,[])

    def test_crash_after_external_effect_recover_uncertain_and_effect_cannot_move(self):
        self.ready();self.bridge.outcome='crash'
        with self.assertRaises(SystemExit):self.dispatch()
        self.coordinator=self.make();state=self.coordinator.recover('fixture-parent',lease='fixture-lease')
        self.assertEqual(state['children'][0]['state'],'uncertain')
        self.bridge.outcome='accepted';self.dispatch()
        self.assertEqual(len(self.bridge.submissions),2)
        self.assertEqual(len([s for s in self.bridge.submissions if s['route']=='ADMIN']),1)
        self.parent('another-parent')
        with self.assertRaises(ValueError):self.coordinator.install_plan('another-parent',self.plan,proof='fixture-auth',lease='fixture-lease')
        with self.assertRaises(ValueError):self.coordinator.reconcile('fixture-parent',state['children'][0]['id'],state='queued',proof='fixture-auth',lease='fixture-lease')

    def test_timeout_and_mismatched_poll_preserve_uncertain_no_replay(self):
        self.ready();self.bridge.outcome='timeout';self.dispatch()
        self.bridge.outcome='accepted';self.dispatch();self.bridge.poll_result='mismatch';self.poll()
        self.coordinator=self.make();self.coordinator.recover('fixture-parent',lease='fixture-lease')
        self.assertIsNone(self.dispatch());self.assertEqual(len(self.bridge.submissions),2)
        self.assertEqual({c['state'] for c in self.coordinator.status('fixture-parent')['children']},{'uncertain'})

    def test_authority_loss_during_effect_cannot_record_success_or_replay(self):
        self.ready();self.bridge.before_submit=lambda:setattr(self.authority,'active',False)
        with self.assertRaises(PermissionError):self.dispatch()
        self.assertEqual(self.coordinator.status('fixture-parent')['children'][0]['state'],'submitting')
        self.authority.active=True;self.bridge.before_submit=None;self.coordinator.recover('fixture-parent',lease='fixture-lease')
        self.assertEqual(self.coordinator.status('fixture-parent')['children'][0]['state'],'uncertain')
        self.assertEqual(len(self.bridge.submissions),1)

    def test_lifetime_action_lock_prevents_concurrent_submit_same_effect(self):
        self.ready();entered=threading.Event();release=threading.Event();errors=[]
        def block():entered.set();release.wait(2)
        self.bridge.before_submit=block
        def run():
            try:self.dispatch()
            except Exception as error:errors.append(error)
        first=threading.Thread(target=run);first.start()
        try:
            self.assertTrue(entered.wait(2))
            with self.assertRaises(BlockingIOError):self.dispatch()
            self.assertEqual(self.coordinator.status('fixture-parent')['state'],'running')
        finally:release.set();first.join(2)
        self.assertEqual(errors,[]);self.assertEqual(len(self.bridge.submissions),1)

    def test_explicit_dependency_waits_for_predecessor_completion(self):
        self.plan[1]['dependencies']=['admin-task'];self.ready();self.dispatch()
        self.assertIsNone(self.dispatch());self.assertEqual(len(self.bridge.submissions),1)
        self.poll();self.dispatch();self.assertEqual(len(self.bridge.submissions),2)

    def test_three_registered_participants_each_receive_distinct_owned_work(self):
        self.registry['STATUS_PROCESS']={'target_id':'STATUS_PROCESS-fixture-thread','provider':'fixture','model':'fixture-model'}
        self.coordinator=self.make();self.parent()
        with self.assertRaises(ValueError):self.coordinator.install_plan('fixture-parent',self.plan,proof='fixture-auth',lease='fixture-lease')
        self.plan.append({'task_id':'status-task','route':'STATUS_PROCESS','responsibility':'Observe aggregate queue health','instruction':'Observe the registered queue health without changing any jobs.','effect_key':'fixture-status-observation','resources':['observation:project-queue-health'],'dependencies':[]})
        self.coordinator.install_plan('fixture-parent',self.plan,proof='fixture-auth',lease='fixture-lease')
        for _ in range(3):self.dispatch()
        for _ in range(3):self.poll()
        self.assertEqual(self.coordinator.status('fixture-parent')['state'],'completed')
        self.assertEqual({item['route'] for item in self.bridge.submissions},set(self.registry))
        self.assertEqual(len({item['instruction'] for item in self.bridge.submissions}),3)
        self.assertEqual(len({item['metadata']['target_id'] for item in self.bridge.submissions}),3)
        duplicate=copy.deepcopy(self.registry);duplicate['STATUS_PROCESS']['target_id']=duplicate['ADMIN']['target_id']
        with self.assertRaises(ValueError):g.GlobalCoordinator(Path(self.tmp.name)/'duplicate-target.sqlite',duplicate)

    def test_unknown_target_or_model_never_receives_a_child(self):
        self.ready();original=self.bridge.probe
        self.bridge.probe=lambda route:original(route)|{'target_id':'wrong-target'}
        self.assertEqual(self.dispatch()['state'],'waiting')
        self.bridge.probe=lambda route:original(route)|{'model':'wrong-model'}
        self.assertEqual(self.dispatch()['state'],'waiting');self.assertEqual(self.bridge.submissions,[])

    def test_paused_first_child_does_not_starve_independent_ready_front(self):
        self.ready();self.bridge.conditions['ADMIN']='session_paused'
        result=self.dispatch()
        self.assertEqual(result['state'],'running')
        self.assertEqual([item['route'] for item in self.bridge.submissions],['PAGINA'])
        state=self.coordinator.status('fixture-parent')
        self.assertEqual(state['children'][0]['state'],'waiting')
        self.assertEqual(state['children'][0]['reason'],'session_paused')
        for _ in range(3):self.assertEqual(self.dispatch()['state'],'waiting')
        with self.coordinator.db() as db:
            notices=db.execute("SELECT COUNT(*) FROM events WHERE child=? AND reason='session_paused'",(state['children'][0]['id'],)).fetchone()[0]
        self.assertEqual(notices,1)
        self.assertEqual(len(self.bridge.submissions),1)
        self.bridge.conditions.clear();self.dispatch()
        self.assertEqual([item['route'] for item in self.bridge.submissions],['PAGINA','ADMIN'])
        self.assertIsNone(self.dispatch())

    def test_failed_probe_does_not_starve_independent_front(self):
        self.ready();original=self.bridge.probe
        def probe(route):
            if route=='ADMIN':raise TimeoutError('fixture_probe_timeout')
            return original(route)
        self.bridge.probe=probe
        self.assertEqual(self.dispatch()['state'],'running')
        self.assertEqual([item['route'] for item in self.bridge.submissions],['PAGINA'])
        self.assertEqual(self.coordinator.status('fixture-parent')['children'][0]['reason'],'session_unavailable')

    def test_uncertain_reconciliation_requires_authorized_correlated_evidence(self):
        self.ready();self.bridge.outcome='timeout';result=self.dispatch();child=result['child_id']
        with self.assertRaises(PermissionError):self.coordinator.reconcile('fixture-parent',child,state='completed',summary='Unsupported claim',proof=True,lease='fixture-lease')
        self.coordinator.reconcile('fixture-parent',child,state='completed',summary='Fixture evidence verified for this exact child.',proof='fixture-auth',lease='fixture-lease')
        state=self.coordinator.status('fixture-parent')['children'][0]
        self.assertEqual(state['state'],'completed');self.assertIn('exact child',state['summary'])
        self.assertEqual(len(self.bridge.submissions),1)


if __name__=='__main__':unittest.main()
