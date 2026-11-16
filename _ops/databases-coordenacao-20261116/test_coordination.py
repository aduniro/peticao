import concurrent.futures
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
import uuid
import psycopg
from coordination import Store, Outbox, digest, import_snapshot, import_queue


class CoordinationTests(unittest.TestCase):
    def setUp(self):
        self.store=Store(os.environ['PETICAO_COORD_CONFIG'],'test-'+uuid.uuid4().hex)

    def task(self,key='one',**kwargs):
        return self.store.create(key,'Synthetic validation task',**kwargs)['id']

    def test_idempotency_and_changed_payload(self):
        a=self.task();self.assertEqual(a,self.task())
        with self.assertRaisesRegex(ValueError,'idempotency_conflict'):
            self.store.create('one','Different payload')

    def test_atomic_two_claimers(self):
        self.task()
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            r=list(pool.map(self.store.claim,['a','b']))
        self.assertEqual(sum(x is not None for x in r),1)

    def test_concurrent_same_idempotency_key(self):
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            r=list(pool.map(lambda _:self.task(),range(2)))
        self.assertEqual(r[0],r[1])

    def test_dependencies_and_evidence(self):
        a=self.task('a',priority=100);b=self.task('b',depends_on=[a])
        self.assertEqual(len(self.store.list(ready_only=True)['items']),1)
        claim=self.store.claim('worker');self.assertEqual(str(claim['id']),a)
        with self.assertRaisesRegex(ValueError,'evidence_required'):
            self.store.complete(a,'worker',claim['token'],claim['fence'],[])
        self.store.complete(a,'worker',claim['token'],claim['fence'],['evidence/synthetic.json'])
        self.assertEqual(str(self.store.claim('worker')['id']),b)

    def test_rollback_invalid_dependency(self):
        with self.assertRaises(ValueError):self.task(depends_on=[str(uuid.uuid4())])
        self.assertEqual(self.store.list()['items'],[])

    def test_namespace_isolation(self):
        other=Store(self.store.config,'other-'+uuid.uuid4().hex)
        a=other.create('one','Other namespace')['id']
        with self.assertRaises(ValueError):self.task(depends_on=[a])
        self.assertIsNone(self.store.claim('worker'))

    def test_assignment_priority_and_pagination(self):
        self.task('a',assigned_to='a',priority=30)
        self.task('b',assigned_to='b',priority=80)
        self.task('c',assigned_to='a',priority=90)
        page=self.store.list(limit=1);self.assertIsNotNone(page['next'])
        second=self.store.list(limit=1,after=page['next'])
        self.assertNotEqual(page['items'][0]['id'],second['items'][0]['id'])
        self.assertEqual(len(self.store.list(agent='a')['items']),2)
        self.assertEqual(len(self.store.list(min_priority=70)['items']),2)
        c=self.store.claim('a');self.assertEqual(str(c['id']),self.store.create('c','Synthetic validation task',90,'a')['id'])

    def test_optimistic_update(self):
        t=self.task();r=self.store.update(t,1,'New title',20,'w');self.assertEqual(r['version'],2)
        with self.assertRaisesRegex(ValueError,'version_or_state'):
            self.store.update(t,1,'Stale title',20,'w')

    def test_fence_and_wrong_owner(self):
        t=self.task();c=self.store.claim('a')
        for agent,token,fence in [('b',c['token'],c['fence']),('a','wrong',c['fence']),('a',c['token'],c['fence']+1)]:
            with self.assertRaises(PermissionError):self.store.complete(t,agent,token,fence,['evidence/test'])

    def test_expiration_requires_reconciliation(self):
        t=self.task();c=self.store.claim('a')
        with self.store.connect() as db:db.execute("UPDATE peticao_coord.tasks SET expires_at=now()-interval '1 second' WHERE id=%s",(t,))
        with self.assertRaises(PermissionError):self.store.complete(t,'a',c['token'],c['fence'],['evidence/test'])
        self.store.expire();self.assertIsNone(self.store.claim('b'))
        with self.assertRaises(ValueError):self.store.reconcile(t,c['fence'],'pending',[])
        self.store.reconcile(t,c['fence'],'pending',['evidence/no_effect_confirmed.json'])
        fresh=self.store.claim('b');self.assertGreater(fresh['fence'],c['fence'])
        with self.assertRaises(PermissionError):self.store.complete(t,'a',c['token'],c['fence'],['evidence/test'])

    def test_event_cursor_and_context(self):
        t=self.task(context=['docs/context.md']);c=self.store.claim('a')
        self.assertEqual(self.store.context(t)['context_refs'],['docs/context.md'])
        first=self.store.events(limit=1);rest=self.store.events(after=first[0]['seq'])
        self.assertEqual(rest[0]['kind'],'claimed')
        self.assertNotIn(c['token'],json.dumps(rest,default=str))

    def test_snapshot_replay_and_corruption(self):
        summary={'watermark':1,'events':1,'actors':1,'lease_states':{}}
        data={'source_id':self.store.namespace,'watermark':1,'summary':summary};s=dict(data,sha256=digest(data))
        self.assertFalse(import_snapshot(self.store,s)['replayed'])
        self.assertTrue(import_snapshot(self.store,s)['replayed'])
        s['summary']['events']=2
        with self.assertRaisesRegex(ValueError,'checksum'):import_snapshot(self.store,s)

    def test_outbox_crash_replay(self):
        with tempfile.TemporaryDirectory() as p:
            o=Outbox(Path(p)/'outbox.sqlite',self.store.namespace,allowed_root=p);payload={'title':'Synthetic outbox task'}
            o.enqueue('intent',payload)
            # Simulate commit on server followed by lost acknowledgement.
            original=self.store.create('intent',**payload)['id']
            fresh=Outbox(Path(p)/'outbox.sqlite',self.store.namespace,allowed_root=p);self.assertEqual(fresh.flush(self.store)['delivered'],1)
            self.assertEqual(len(self.store.list()['items']),1)
            self.assertEqual(str(self.store.list()['items'][0]['id']),original)
            self.assertEqual(fresh.flush(self.store)['delivered'],0)

    def test_offline_fails_closed_and_preserves_intents(self):
        class Offline:
            namespace=self.store.namespace
            def create(self,*args,**kwargs):raise psycopg.OperationalError('offline')
        with tempfile.TemporaryDirectory() as p:
            o=Outbox(Path(p)/'outbox.sqlite',self.store.namespace,allowed_root=p);o.enqueue('x',{'title':'Synthetic offline task'})
            self.assertEqual(o.flush(Offline())['delivered'],0)
            self.assertEqual(o.flush(self.store)['delivered'],1)
        with self.assertRaisesRegex(PermissionError,'authority_remains'):self.store.live_dispatch()

    def test_decision_and_directory_without_voting(self):
        r=self.store.register_agent('synthetic-'+self.store.namespace,None,'test',['docs/test'])
        self.assertFalse(r['voting_member'])
        self.store.decision('Synthetic question','Isolated validation',['evidence/test'])
        self.assertEqual(self.store.events()[0]['kind'],'decision')

    def test_bounded_queries_and_private_config(self):
        with self.assertRaises(ValueError):self.store.list(limit=101)
        with tempfile.TemporaryDirectory() as p:
            cfg=Path(p)/'bad.json';cfg.write_text('{"mode":"live"}');cfg.chmod(0o600)
            with self.assertRaisesRegex(PermissionError,'cutover'):Store(cfg)
            cfg.chmod(0o644)
            with self.assertRaisesRegex(PermissionError,'0600'):Store(cfg)

    def test_queue_projection_read_only_authority_and_replay(self):
        data={'source_id':self.store.namespace,'watermark':5,'jobs':[{'id':'synthetic-job','state':'completed','generation':1,
              'digest':'a'*64,'created_at':'2026-11-16','updated_at':'2026-11-16'}]}
        snap=dict(data,sha256=digest(data))
        self.assertFalse(import_queue(self.store,snap)['replayed'])
        self.assertTrue(import_queue(self.store,snap)['replayed'])
        self.assertIsNone(self.store.claim('a'))  # projected jobs never enter claimable tasks
        stale=dict(data,watermark=4);stale['sha256']=digest(stale)
        with self.assertRaisesRegex(ValueError,'stale_snapshot'):import_queue(self.store,stale)
        changed=dict(data,watermark=6,jobs=[dict(data['jobs'][0],payload='private')]);changed['sha256']=digest(changed)
        with self.assertRaisesRegex(ValueError,'private_fields'):import_queue(self.store,changed)

    def test_queue_snapshot_has_no_payload_and_does_not_mutate_sqlite(self):
        import sqlite3
        from queue_export import export
        with tempfile.TemporaryDirectory() as p:
            path=Path(p)/'queue.sqlite'
            with sqlite3.connect(path) as db:
                db.executescript('CREATE TABLE jobs(id,state,generation,digest,created_at,updated_at,payload); CREATE TABLE events(seq);')
                db.execute("INSERT INTO jobs VALUES('test','running',1,'digest','now','now','PRIVATE_FIXTURE')")
                db.execute('INSERT INTO events VALUES(7)')
            before=path.read_bytes();snap=export(path,'test')
            self.assertNotIn('PRIVATE_FIXTURE',json.dumps(snap));self.assertEqual(path.read_bytes(),before)

    def test_unknown_sqlite_and_parent_symlink_rejected_before_write(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as p,tempfile.TemporaryDirectory() as other:
            root=Path(p);path=root/'native-fixture.sqlite'
            with sqlite3.connect(path) as db:db.execute('CREATE TABLE native_state(value)')
            path.chmod(0o600);before=path.read_bytes()
            with self.assertRaisesRegex(PermissionError,'unrecognized_outbox_database'):Outbox(path,allowed_root=p)
            self.assertEqual(path.read_bytes(),before)
            (root/'link').symlink_to(other,target_is_directory=True)
            with self.assertRaisesRegex(PermissionError,'outside_dedicated_root'):Outbox(root/'link/outbox.sqlite',allowed_root=p)
            self.assertFalse((Path(other)/'outbox.sqlite').exists())

    def test_outbox_concurrent_conflicting_payloads(self):
        with tempfile.TemporaryDirectory() as p:
            o=Outbox(Path(p)/'outbox.sqlite',self.store.namespace,allowed_root=p)
            barrier=threading.Barrier(2)
            def enqueue(i):
                barrier.wait()
                try:o.enqueue('same',{'title':'Synthetic '+str(i)});return 'ok'
                except ValueError:return 'conflict'
            with concurrent.futures.ThreadPoolExecutor(2) as pool:r=list(pool.map(enqueue,[1,2]))
            self.assertEqual(sorted(r),['conflict','ok'])

    def test_outbox_namespace_and_corruption_guards(self):
        import sqlite3
        with tempfile.TemporaryDirectory() as p:
            path=Path(p)/'outbox.sqlite';o=Outbox(path,self.store.namespace,allowed_root=p)
            o.enqueue('same',{'title':'Synthetic'})
            other=Store(self.store.config,'other-'+uuid.uuid4().hex)
            with self.assertRaisesRegex(ValueError,'namespace_mismatch'):o.flush(other)
            with sqlite3.connect(path) as db:db.execute("UPDATE intents SET payload=?",(json.dumps({'title':'Corrupted'}),))
            with self.assertRaisesRegex(ValueError,'payload_checksum'):o.flush(self.store)
            self.assertEqual(self.store.list()['items'],[])

    def test_concurrent_conflicting_ledger_snapshots_and_wrapper(self):
        def snapshot(actors):
            data={'source_id':self.store.namespace,'watermark':8,'summary':{'watermark':8,'actors':actors,'events':8,'lease_states':{}}}
            return dict(data,sha256=digest(data))
        barrier=threading.Barrier(2)
        def ingest(i):
            barrier.wait()
            try:import_snapshot(self.store,snapshot(i));return 'ok'
            except ValueError as e:return str(e)
        with concurrent.futures.ThreadPoolExecutor(2) as pool:r=list(pool.map(ingest,[1,2]))
        self.assertEqual(sorted(r),['ok','source_watermark_conflict'])
        changed=snapshot(1);changed['watermark']=9
        with self.assertRaisesRegex(ValueError,'watermark_mismatch'):import_snapshot(self.store,changed)

    def test_queue_full_snapshot_omitted_row_not_current(self):
        row={'id':'old','state':'completed','generation':1,'digest':'b'*64,'created_at':'now','updated_at':'now'}
        first={'source_id':self.store.namespace,'watermark':1,'jobs':[row]};import_queue(self.store,dict(first,sha256=digest(first)))
        second={'source_id':self.store.namespace,'watermark':2,'jobs':[]};import_queue(self.store,dict(second,sha256=digest(second)))
        self.assertEqual(self.store.external_jobs(self.store.namespace)['items'],[])
        with self.store.connect() as db:
            self.assertEqual(db.execute('SELECT COUNT(*) AS n FROM peticao_coord.queue_projection WHERE source_id=%s',(self.store.namespace,)).fetchone()['n'],1)

    def test_expiry_checked_after_row_lock_wait(self):
        task=self.task();claim=self.store.claim('a')
        locked=threading.Event();deadline=[]
        def hold():
            with self.store.connect() as db:
                r=db.execute("UPDATE peticao_coord.tasks SET expires_at=clock_timestamp()+interval '3 seconds' WHERE id=%s RETURNING expires_at",(task,)).fetchone()
                deadline.append(r['expires_at']);locked.set();time.sleep(4)
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            future=pool.submit(hold);self.assertTrue(locked.wait(timeout=10))
            original=self.store.connect
            def measured(*args,**kwargs):
                db=original(*args,**kwargs)
                self.assertTrue(db.execute('SELECT transaction_timestamp()<%s AS before_deadline',(deadline[0],)).fetchone()['before_deadline'])
                return db
            self.store.connect=measured
            with self.assertRaises(PermissionError):self.store.complete(task,'a',claim['token'],claim['fence'],['evidence/test'])
            future.result()

    def test_real_backlog_progress_is_not_completion_or_dispatch(self):
        task=self.task(assigned_to='infra',context=['docs/baseline'])
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            r=list(pool.map(lambda a:self.store.progress(task,a,['evidence/'+a]),['infra','root']))
        ctx=self.store.context(task)
        self.assertEqual(ctx['status'],'pending');self.assertEqual(set(ctx['evidence_refs']),{'evidence/infra','evidence/root'})
        self.assertEqual(ctx['version'],3)
        self.assertEqual(len([e for e in self.store.events() if e['kind']=='progress']),2)


if __name__=='__main__':unittest.main(verbosity=2)
