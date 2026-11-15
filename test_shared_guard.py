"""Same private SQLite integration; no real legacy launcher or host process."""
import contextlib
import json
from pathlib import Path
import sqlite3
import subprocess
import types
import unittest
from unittest import mock

import test_consumer as fixtures
from test_consumer import ConsumerPending, contract
from shared_guard import PairedGuard, GuardPending, TABLE
from legacy_successor import PairedLegacyDispatcher


class SharedSlotTests(unittest.TestCase):
    def setUp(self):
        self.f=fixtures.ConsumerTests();self.f.setUp();self.addCleanup(self.f.tearDown);self.f.install()
        self.guard=PairedGuard(lambda worker:{'worker_id':worker,'reviewed':True,'legacy_guard_enabled':True,
                              'consumer_guard_enabled':True,'paired_revision_sha256':'d'*64,'queue_path':str(self.f.queue)})
        self.f.consumer.paired_guard=self.guard
        self.local='3'*32;self.worker=self.f.root/'legacy-worker';(self.worker/'jobs').mkdir(parents=True)
        payload={'kind':'fixture-pass','duration_seconds':0}
        with contract.transaction(self.f.queue,True) as db:
            db.execute("INSERT INTO jobs(id,payload,digest,state,generation,created_at,updated_at) VALUES(?,?,?,'queued',1,'test','test')",
                       (self.local,contract.canonical(payload),contract.digest(payload)))
        @contextlib.contextmanager
        def connect():
            db=sqlite3.connect(self.f.queue);db.row_factory=sqlite3.Row
            try:yield db;db.commit()
            except BaseException:db.rollback();raise
            finally:db.close()
        def atomic(path,value,mode):
            with Path(path).open('x') as f:f.write(json.dumps(value))
        def event(db,job,kind,data):db.execute('INSERT INTO events(at,job_id,kind,data) VALUES(?,?,?,?)',('test',job,kind,contract.canonical(data)))
        self.legacy=types.SimpleNamespace(primary=self.f.facade.primary,connect=connect,WORKER=self.worker,
                     stamp=lambda:'test',remote_job=lambda row:json.loads(row['payload']).get('backend')==contract.BACKEND,
                     atomic=atomic,event=event,validate_id=lambda value:contract.hex_value(value,32),LAUNCHER='/usr/local/libexec/admin-v2-launch')
        self.launch=mock.Mock()
        self.dispatcher=PairedLegacyDispatcher(self.legacy,self.guard,launcher=self.launch)

    def slot(self,job):
        with contract.transaction(self.f.queue) as db:return dict(db.execute(f'SELECT * FROM {TABLE} WHERE job_id=?',(job,)).fetchone())

    def proof(self,job):
        with contract.transaction(self.f.queue) as db:row=db.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone()
        return {'job_id':job,'generation':1,'worker_id':'civo','backend':'legacy-local','payload_sha256':row['digest'],
                'state':row['state'],'unit_stopped':True,'cgroup_empty':True,'processes_drained':True,
                'artifact_custody_verified':True,'result_sha256':'a'*64,'custody_receipt_sha256':'b'*64,'state_receipt_sha256':'c'*64}

    def test_default_missing_paired_review_blocks_both_sides(self):
        self.f.consumer.paired_guard=PairedGuard()
        with self.assertRaises(GuardPending):self.f.consumer.start(self.f.job)
        before=len(list((self.worker/'jobs').iterdir()))
        with self.assertRaises(GuardPending):PairedLegacyDispatcher(self.legacy,launcher=self.launch).dispatch_once()
        self.assertEqual(len(list((self.worker/'jobs').iterdir())),before);self.launch.assert_not_called()

    def test_remote_slot_blocks_legacy_during_prepare_before_claim(self):
        observed=[]
        def factory():
            with contract.transaction(self.f.queue) as db:
                self.assertEqual(db.execute('SELECT state FROM jobs WHERE id=?',(self.f.job,)).fetchone()[0],'queued')
                self.assertEqual(db.execute('SELECT count(*) FROM remote_execution_claims').fetchone()[0],0)
            observed.append(self.dispatcher.dispatch_once())
            return 'a'*64
        self.f.tokens.factory=factory
        self.f.consumer.start(self.f.job)
        self.assertEqual(observed,[None]);self.launch.assert_not_called()
        self.assertFalse((self.worker/'jobs'/self.local).exists())

    def test_legacy_slot_blocks_remote_until_terminal_and_custody(self):
        self.assertEqual(self.dispatcher.dispatch_once(),self.local);self.launch.assert_called_once_with(self.local)
        with self.assertRaises(ConsumerPending):self.f.consumer.start(self.f.job)
        with contract.transaction(self.f.queue,True) as db:db.execute("UPDATE jobs SET state='completed' WHERE id=?",(self.local,))
        with self.assertRaises(GuardPending):self.dispatcher.retire(self.local)
        self.assertTrue(self.slot(self.local)['active'])
        self.dispatcher.terminal_provider=self.proof
        self.assertTrue(self.dispatcher.retire(self.local)['changed'])
        self.assertFalse(self.dispatcher.retire(self.local)['changed'])
        self.assertTrue(self.f.consumer.start(self.f.job)['slot_retained'])

    def test_per_node_capacity_does_not_serialize_akamai_and_civo(self):
        remote='4'*32;self.f.add_job(remote,worker_id='akamai')
        self.f.consumer.start(remote)
        self.assertEqual(self.dispatcher.dispatch_once(),self.local)
        self.assertTrue(self.slot(remote)['active']);self.assertTrue(self.slot(self.local)['active'])
        self.assertEqual(self.slot(remote)['worker_id'],'akamai');self.assertEqual(self.slot(self.local)['worker_id'],'civo')

    def test_global_or_missing_index_is_not_a_valid_shared_guard(self):
        with contract.transaction(self.f.queue,True) as db:
            db.execute('DROP INDEX canonical_consumer_one_slot')
            db.execute(f'CREATE UNIQUE INDEX canonical_consumer_one_slot ON {TABLE}(active) WHERE active=1')
            with self.assertRaises(GuardPending):self.guard.check(db,'civo')

    def test_legacy_failed_launch_retains_slot_without_retry(self):
        self.launch.side_effect=subprocess.TimeoutExpired('fixed-test',20)
        self.assertEqual(self.dispatcher.dispatch_once(),self.local)
        self.assertTrue(self.slot(self.local)['active'])
        self.assertIsNone(self.dispatcher.dispatch_once());self.assertEqual(self.launch.call_count,1)
        with self.assertRaises(ConsumerPending):self.f.consumer.start(self.f.job)

    def test_bad_legacy_terminal_or_custody_proof_never_releases(self):
        self.dispatcher.dispatch_once()
        with contract.transaction(self.f.queue,True) as db:db.execute("UPDATE jobs SET state='completed' WHERE id=?",(self.local,))
        for key,value in [('cgroup_empty',False),('unit_stopped',1),('generation',2),('custody_receipt_sha256','0'*64),('payload_sha256','0'*64)]:
            proof=self.proof(self.local);proof[key]=value;self.dispatcher.terminal_provider=lambda _:proof
            with self.assertRaises(GuardPending):self.dispatcher.retire(self.local)
            self.assertTrue(self.slot(self.local)['active'])

    def test_review_for_another_database_is_refused(self):
        self.guard.review_provider=lambda worker:{'worker_id':worker,'reviewed':True,'legacy_guard_enabled':True,
            'consumer_guard_enabled':True,'paired_revision_sha256':'d'*64,'queue_path':str(self.f.root/'other.sqlite')}
        with self.assertRaises(GuardPending):self.dispatcher.dispatch_once()
        self.launch.assert_not_called()

    def test_guard_changed_after_reserve_blocks_launcher_and_retains_slot(self):
        original=self.legacy.atomic
        def changed(*args):
            original(*args)
            self.guard.review_provider=None
        self.legacy.atomic=changed
        with self.assertRaises(GuardPending):self.dispatcher.dispatch_once()
        self.launch.assert_not_called();self.assertTrue(self.slot(self.local)['active'])

    def test_legacy_custody_provider_never_called_before_guard_review(self):
        self.dispatcher.dispatch_once()
        with contract.transaction(self.f.queue,True) as db:db.execute("UPDATE jobs SET state='completed' WHERE id=?",(self.local,))
        provider=mock.Mock();self.dispatcher.terminal_provider=provider;self.guard.review_provider=None
        with self.assertRaises(GuardPending):self.dispatcher.retire(self.local)
        provider.assert_not_called();self.assertTrue(self.slot(self.local)['active'])

    def test_corrupt_legacy_job_path_never_reaches_filesystem_or_launcher(self):
        with contract.transaction(self.f.queue,True) as db:db.execute('UPDATE jobs SET id=? WHERE id=?',('../../escape',self.local))
        with self.assertRaises(ValueError):self.dispatcher.dispatch_once()
        self.launch.assert_not_called();self.assertEqual(list((self.worker/'jobs').iterdir()),[])


if __name__=='__main__':unittest.main()
