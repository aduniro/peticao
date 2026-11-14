import hashlib
import json
from datetime import datetime, timezone, timedelta
from pathlib import Path
import tempfile
import unittest

from durable_api import Journal, Api, atomic, LifecycleLock
from financial_guard import deadlines
from financial_runtime import Controller
from usage_observer import summarize, windows


class CrashJournal(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);self.j=Journal(self.root,lambda:None)

    def test_timeout_cannot_repeat_post(self):
        calls=[]
        def uncertain(): calls.append(1);raise TimeoutError()
        request={'method':'POST','path':'/v2/instances'}
        with self.assertRaises(TimeoutError):self.j.perform('create',request,uncertain,lambda x:None)
        with self.assertRaisesRegex(RuntimeError,'Uncertain'):
            self.j.perform('create',request,uncertain,lambda x:None)
        self.assertEqual(len(calls),1)

    def test_completed_request_cannot_drift(self):
        self.j.perform('create',{'size':'g4c.medium'},lambda:{'id':'owned'},lambda x:None)
        with self.assertRaisesRegex(RuntimeError,'drift'):
            self.j.perform('create',{'size':'gpu'},lambda:{},lambda x:None)

    def test_second_controller_cannot_hold_lock(self):
        with LifecycleLock(self.root/'lock'):
            with self.assertRaises(BlockingIOError):
                with LifecycleLock(self.root/'lock'):pass

    def test_credential_cannot_silently_switch_account(self):
        p=self.root/'token';p.write_text('test-only-fake-token');p.chmod(0o600)
        with self.assertRaisesRegex(ValueError,'identity'):
            Api(p,self.root/'logs','0'*64)


class FakeApi:
    def __init__(self, resources):
        self.live={('/v2/'+x['kind']+'/'+x['id']):dict(id=x['id'],**x['expected']) for x in resources}
        self.deletes=[];self.crash_after_delete=False
    def request(self,method,path,**kwargs):
        if method=='GET':return self.live.get(path,{'_not_found':True})
        if method=='DELETE':
            self.deletes.append(path);self.live.pop(path,None)
            if self.crash_after_delete:
                self.crash_after_delete=False;raise TimeoutError()
            return {'result':'success'}
        raise AssertionError('Runtime must never POST or resize')


class FakeAdapter:
    def __init__(self, now):self.now=now;self.jobs=0;self.export_ok=True;self.drains=0
    def drain(self,ident):self.drains+=1
    def snapshot(self,ident):
        return dict(instance_id=ident,at=self.now.isoformat(),authority_verified=True,
                    admission_closed=True,running=self.jobs,finalizing=0,exports_pending=0)
    def export_verified(self,resources):
        return dict(instance_id=resources[0]['id'],worker_frozen=True,sha256_verified=self.export_ok,
                    resource_ids=[x['id'] for x in resources],verified_at=self.now.isoformat())
    def assert_frozen(self,*args):pass


class RuntimeSafety(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name);(self.root/'journal').mkdir()
        self.now=datetime(2026,12,5,tzinfo=timezone.utc)
        grant=dict(provenance='authenticated_owner',account_scope_id='a',grant_evidence_id='g',
                   currency='USD',initial_usd='250',baseline_spent_usd='0',expires_at='2026-12-31T00:00:00Z')
        schedule=deadlines(grant,dict(currency='USD',complete_mandatory_costs=True,hourly_usd='0.410752'),
                           (self.now-timedelta(days=20)).isoformat())
        self.resources=[dict(kind='instances',id='11111111-1111-4111-8111-111111111111',creation_key='instance',expected={'hostname':'own','size':'g4c.medium'}),
                        dict(kind='volumes',id='22222222-2222-4222-8222-222222222222',creation_key='volume',expected={'name':'own-volume','size_gb':200})]
        for r in self.resources:
            request={'method':'POST','path':'/v2/'+r['kind']}
            atomic(self.root/'journal'/(r['creation_key']+'.json'),dict(state='completed',request=request,
                   request_sha256=hashlib.sha256(json.dumps(request,sort_keys=True).encode()).hexdigest(),response={'id':r['id']}))
        self.receipt=dict(account_scope_id='a',schedule=schedule,resources=self.resources)
        self.api=FakeApi(self.resources);self.adapter=FakeAdapter(self.now)
        charges=dict(observed_at=self.now.isoformat(),account_total_usd='0',grant_initial_usd='250',
                     complete_account_scope=True,currency='USD',account_scope_id='a',grant_evidence_id='g')
        self.controller=Controller(self.root,{'account_scope_id':'a'},self.receipt,self.api,
                       Journal(self.root/'journal',lambda:None),self.adapter,lambda now:charges,
                       lambda:None,clock=lambda:self.now)

    def test_cleanup_deletes_only_bound_instance_then_volume(self):
        result=self.controller.tick(self.now)
        self.assertEqual(result['state'],'owned_resources_absent')
        self.assertEqual(self.api.deletes,['/v2/'+r['kind']+'/'+r['id'] for r in self.resources])

    def test_running_work_prevents_deletion_even_after_deadline(self):
        self.adapter.jobs=1
        self.assertEqual(self.controller.tick(self.now)['state'],'draining_work')
        self.assertEqual(self.api.deletes,[])

    def test_unverified_export_preserves_resources(self):
        self.adapter.export_ok=False
        self.assertEqual(self.controller.tick(self.now)['state'],'export_unverified')
        self.assertEqual(self.api.deletes,[])

    def test_no_receipt_cannot_adopt_resource(self):
        self.receipt['resources'][0]['id']='33333333-3333-4333-8333-333333333333'
        with self.assertRaises(ValueError):self.controller.tick(self.now)
        self.assertEqual(self.api.deletes,[])

    def test_api_identity_drift_preserves_all_resources(self):
        key='/v2/volumes/'+self.resources[1]['id'];self.api.live[key]['name']='preexisting-other'
        with self.assertRaises(ValueError):self.controller.tick(self.now)
        self.assertEqual(self.api.deletes,[])

    def test_crash_after_instance_delete_recovers_owned_volume_without_second_delete(self):
        self.api.crash_after_delete=True
        with self.assertRaises(TimeoutError):self.controller.tick(self.now)
        self.assertEqual(len(self.api.deletes),1)
        self.assertEqual(self.controller.tick(self.now)['state'],'owned_resources_absent')
        self.assertEqual(len(self.api.deletes),2)


class Usage(unittest.TestCase):
    def setUp(self):
        self.a=datetime(2026,11,13,tzinfo=timezone.utc);self.b=self.a+timedelta(hours=1)
        self.rates={'NYC1:instance-g4c.medium':{'usd_per_hour':'0.380952'}}
        self.row=dict(code='instance-g4c.medium',region='NYC1',product_id='own',
                      num_hours=1,size_gb=None,**{'from':self.a.isoformat(),'to':self.b.isoformat()})
    def test_hours_are_not_mistaken_for_dollar_balance(self):
        self.assertEqual(str(summarize([self.row],self.rates,self.a,self.b)),'0.380952')
    def test_unknown_product_or_region_refuses_monetary_claim(self):
        for row in [dict(self.row,code='gpu-unknown'),dict(self.row,region='LON1')]:
            with self.assertRaises(ValueError):summarize([row],self.rates,self.a,self.b)
    def test_full_grant_window_includes_previous_month_and_31_day_limit(self):
        parts=list(windows(self.a,self.a+timedelta(days=48)))
        self.assertEqual(parts[0][0],self.a)
        self.assertEqual(parts[0][1],parts[1][0])
        self.assertTrue(all((b-a).days<=30 for a,b in parts))


if __name__=='__main__':unittest.main()
