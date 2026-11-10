import copy
import hashlib
import os
import sqlite3
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import uuid
from admin_exec.queue import Queue,QueueError
from protocol import ValidationError,validate_job
from tests.helpers import Clock,fixture_config,job_data,ready,result

class QueueTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.clock=Clock();self.c=fixture_config(self.root);self.q=Queue(self.c['state_path'],self.c,self.clock);self.job=job_data(self.c);self.spec=validate_job(self.job,self.c)
    def tearDown(self):self.tmp.cleanup()
    def enqueue_ready(self):self.q.enqueue(self.spec);self.q.register_ready(ready(self.c,self.clock))
    def running(self):
        self.enqueue_ready();r=self.q.claim(self.job['job_id'],'santiago',1)['job'];return self.q.start(self.job['job_id'],r['claim_id'],r['generation'],r['version'],{'host':'santiago','pid':123,'session_id':str(uuid.uuid4())})['job']
    def test_queue_path_cannot_bypass_config_and_config_is_detached(self):
        with self.assertRaises(ValidationError):Queue('/opt/peticao/queue.sqlite',self.c,self.clock)
        view=self.q.config;view['execution_enabled']=False
        self.assertTrue(self.q.config['execution_enabled'])

    def test_foreign_database_and_shared_parent_are_not_modified(self):
        path=Path(self.c['state_path']);path.parent.mkdir(mode=0o700)
        connection=sqlite3.connect(path);connection.execute('CREATE TABLE unrelated(value)');connection.commit();connection.close();os.chmod(path,0o600)
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        with self.assertRaises(QueueError):self.q.enqueue(self.spec)
        with self.assertRaises(QueueError):self.q.status()
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before)
        path.unlink();os.chmod(path.parent,0o755)
        with self.assertRaises(QueueError):self.q.enqueue(self.spec)
        self.assertEqual(path.parent.stat().st_mode & 0o777,0o755);self.assertFalse(path.exists())

    def test_read_only_status_never_creates_a_database(self):
        self.assertFalse(self.q.status()['exists']);self.assertFalse(Path(self.c['state_path']).parent.exists())
    def test_duplicate_job_or_intent_never_schedules_another_execution(self):
        first=self.q.enqueue(self.spec);self.assertTrue(first['created']);self.assertFalse(self.q.enqueue(self.spec)['created'])
        same=copy.deepcopy(self.job);same['job_id']=str(uuid.uuid4());self.assertEqual(self.q.enqueue(validate_job(same,self.c))['job']['job_id'],self.job['job_id'])
        other=copy.deepcopy(self.job);other['source']['commit']='9'*40
        with self.assertRaises(QueueError):self.q.enqueue(validate_job(other,self.c))
    def test_disabled_activation_and_missing_or_expired_ready_are_fail_closed(self):
        self.q.enqueue(self.spec)
        with self.assertRaises(QueueError):self.q.claim(self.job['job_id'],'santiago',1)
        c=fixture_config(self.root,False);q=Queue(c['state_path'],c,self.clock);q.register_ready(ready(c,self.clock))
        with self.assertRaises(QueueError):q.claim(self.job['job_id'],'santiago',1)
        self.q.register_ready(ready(self.c,self.clock));self.clock.advance(1201)
        with self.assertRaises(QueueError):self.q.claim(self.job['job_id'],'santiago',1)
    def test_coordinator_ready_is_not_accepted_as_a_job_worker(self):
        h=ready(self.c,self.clock);h.update(worker_id='local',role='coordinator',repository_root=self.c['hosts']['local']['repository_root'])
        with self.assertRaises(QueueError):self.q.register_ready(h)

    def test_claim_cas_is_atomic_under_two_competing_callers(self):
        self.enqueue_ready()
        def claim(_):
            try:return self.q.claim(self.job['job_id'],'santiago',1)['ok']
            except QueueError:return False
        with ThreadPoolExecutor(max_workers=2)as pool:answers=list(pool.map(claim,range(2)))
        self.assertEqual(answers.count(True),1);row=self.q.status()['jobs'][0];self.assertEqual(row['status'],'claimed');self.assertEqual(row['generation'],1)
    def test_claim_is_not_reported_as_started_and_wrong_owners_are_rejected(self):
        self.enqueue_ready();r=self.q.claim(self.job['job_id'],'santiago',1)['job'];self.assertEqual(r['status'],'claimed');self.assertIsNone(r['process_ref'])
        with self.assertRaises(QueueError):self.q.start(self.job['job_id'],str(uuid.uuid4()),1,r['version'],{'host':'santiago','pid':123,'session_id':str(uuid.uuid4())})
        with self.assertRaises(QueueError):self.q.claim(self.job['job_id'],'sao_paulo',r['version'])
    def test_heartbeat_has_cas_and_idempotent_message_without_extending_duplicate(self):
        r=self.running();self.clock.advance(20);msg=str(uuid.uuid4());args=(self.job['job_id'],r['claim_id'],1,r['version'],msg,'testing')
        first=self.q.heartbeat(*args);self.clock.advance(20);second=self.q.heartbeat(*args);self.assertTrue(second['duplicate']);self.assertEqual(second['job']['lease_until'],first['job']['lease_until'])
        with self.assertRaises(QueueError):self.q.heartbeat(*args[:-1],'building')
    def test_expired_lease_becomes_uncertain_and_cannot_be_reclaimed_or_finished(self):
        r=self.running();payload=result(self.c,self.job,r);self.clock.advance(181)
        view=self.q.status()['jobs'][0];self.assertEqual(view['effective_status'],'uncertain');self.assertFalse(view['active_lease'])
        blocked=self.q.claim(self.job['job_id'],'santiago',r['version']);self.assertFalse(blocked['ok']);self.assertEqual(blocked['job']['status'],'uncertain')
        self.assertFalse(self.q.finish(self.job['job_id'],r['claim_id'],1,r['version'],payload)['ok']);self.assertEqual(self.q.status()['jobs'][0]['generation'],1)
        other=job_data(self.c);self.q.enqueue(validate_job(other,self.c))
        with self.assertRaises(QueueError):self.q.claim(other['job_id'],'santiago',1)
    def test_execution_timeout_cannot_be_hidden_by_heartbeats(self):
        r=self.running()
        for _ in range(5):
            self.clock.advance(100);r=self.q.heartbeat(self.job['job_id'],r['claim_id'],1,r['version'],str(uuid.uuid4()),'testing')['job']
        self.clock.advance(100);r=self.q.heartbeat(self.job['job_id'],r['claim_id'],1,r['version'],str(uuid.uuid4()),'testing')
        self.assertFalse(r['ok']);self.assertEqual(r['job']['reason'],'execution_timeout_no_automatic_retry')
    def test_finish_and_receipt_verify_artifact_files_and_do_not_accept_conflicting_result(self):
        r=self.running();payload=result(self.c,self.job,r);args=(self.job['job_id'],r['claim_id'],1,r['version'],payload)
        first=self.q.finish(*args);self.assertEqual(first['job']['status'],'completed');self.assertTrue(first['job']['review_required']);self.assertTrue(self.q.finish(*args)['duplicate'])
        receipt=self.q.completed_receipt(self.job['job_id']);self.assertEqual(receipt.result['commit'],self.job['source']['commit'])
        wrong=copy.deepcopy(payload);wrong['coverage'].pop()
        with self.assertRaises(ValidationError):self.q.finish(*args[:-1],wrong)
        (Path(self.c['artifact_root'])/payload['execution_artifact']).write_text('{}')
        with self.assertRaises(ValidationError):self.q.completed_receipt(self.job['job_id'])
    def test_expiration_during_artifact_validation_is_rechecked_before_commit(self):
        r=self.running();payload=result(self.c,self.job,r)
        from protocol import validate_result as real_validate
        def slow(*args,**kwargs):
            result_value=real_validate(*args,**kwargs);self.clock.advance(181);return result_value
        with patch('admin_exec.queue.validate_result',slow):out=self.q.finish(self.job['job_id'],r['claim_id'],1,r['version'],payload)
        self.assertFalse(out['ok']);self.assertEqual(out['job']['status'],'uncertain')
        with self.assertRaises(QueueError):self.q.completed_receipt(self.job['job_id'])
    def test_failed_job_has_no_completion_receipt(self):
        r=self.running();out=self.q.finish(self.job['job_id'],r['claim_id'],1,r['version'],result(self.c,self.job,r,1));self.assertEqual(out['job']['status'],'failed')
        with self.assertRaises(QueueError):self.q.completed_receipt(self.job['job_id'])
