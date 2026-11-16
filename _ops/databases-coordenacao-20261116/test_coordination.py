import concurrent.futures
import json
import os
from pathlib import Path
import tempfile
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
        summary={'watermark':1,'events':1};s={'source_id':self.store.namespace,'watermark':1,'summary':summary,'sha256':digest(summary)}
        self.assertFalse(import_snapshot(self.store,s)['replayed'])
        self.assertTrue(import_snapshot(self.store,s)['replayed'])
        s['summary']['events']=2
        with self.assertRaisesRegex(ValueError,'checksum'):import_snapshot(self.store,s)

    def test_outbox_crash_replay(self):
        with tempfile.TemporaryDirectory() as p:
            o=Outbox(Path(p)/'outbox.sqlite');payload={'title':'Synthetic outbox task'}
            o.enqueue('intent',payload)
            # Simulate commit on server followed by lost acknowledgement.
            original=self.store.create('intent',**payload)['id']
            fresh=Outbox(Path(p)/'outbox.sqlite');self.assertEqual(fresh.flush(self.store)['delivered'],1)
            self.assertEqual(len(self.store.list()['items']),1)
            self.assertEqual(str(self.store.list()['items'][0]['id']),original)
            self.assertEqual(fresh.flush(self.store)['delivered'],0)

    def test_offline_fails_closed_and_preserves_intents(self):
        class Offline:
            def create(self,*args,**kwargs):raise psycopg.OperationalError('offline')
        with tempfile.TemporaryDirectory() as p:
            o=Outbox(Path(p)/'outbox.sqlite');o.enqueue('x',{'title':'Synthetic offline task'})
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


if __name__=='__main__':unittest.main(verbosity=2)
