import importlib.util
import json
from pathlib import Path
import sys
import threading
import unittest
from unittest.mock import patch
import test_executor as fixture

SPEC=importlib.util.spec_from_file_location('email_executor_worker',Path(__file__).resolve().parents[1]/'executor'/'worker.py')
worker=importlib.util.module_from_spec(SPEC)
with patch.dict(sys.modules,{'executor':fixture.e}):
    SPEC.loader.exec_module(worker)


class WorkerTests(unittest.TestCase):
    def setUp(self):
        self.fixture=fixture.ExecutorTest()
        self.fixture.setUp()
        self.executor=self.fixture.executor
        self.messages=[]
        self.pulses=[]

    def tearDown(self):
        self.fixture.tearDown()

    def deliver(self,message):
        self.messages.append(message)
        return {'state':'accepted','provider_id':'fixture-'+message['id']}

    def run_worker(self,cycles=3,**kwargs):
        return worker.Worker(self.executor,interval=0.05,heartbeat=self.pulses.append,**kwargs).run(max_cycles=cycles)

    def test_startup_recovers_once_and_never_replays_interrupted_submit(self):
        request=self.fixture.ingest()
        with self.executor.db() as db:
            self.executor.transition(db,request['id'],'submitted')
        with patch.object(self.executor,'recover',wraps=self.executor.recover) as recovery:
            result=self.run_worker(deliver=self.deliver)
        self.assertEqual(recovery.call_count,1)
        self.assertEqual(result['state'],'stopped')
        self.assertEqual(self.executor.list_status()[0]['state'],'uncertain')
        self.assertEqual(self.fixture.adapter.submissions,[])
        self.assertEqual(len({m['id'] for m in self.messages}),len(self.messages))
        self.assertTrue(any(m['kind']=='uncertain' for m in self.messages))
        self.assertNotIn('Revisar somente',json.dumps(self.pulses))

    def test_only_one_persistent_worker_can_hold_database_lock(self):
        stop=threading.Event()
        started=threading.Event()
        first=worker.Worker(self.executor,interval=0.05,stop_event=stop,heartbeat=lambda value:started.set() if value['state']=='started' else None)
        thread=threading.Thread(target=first.run)
        thread.start()
        try:
            self.assertTrue(started.wait(2))
            with self.assertRaises(BlockingIOError):
                self.run_worker(cycles=1)
        finally:
            stop.set();thread.join(2)
        self.assertFalse(thread.is_alive())

    def test_pause_preserved_and_missing_transport_does_not_claim_outbox(self):
        self.fixture.ingest()
        self.run_worker(paused=lambda:True)
        self.assertEqual(self.fixture.adapter.submissions,[])
        self.assertEqual(self.executor.list_status()[0]['state'],'queued')
        with self.executor.db() as db:
            self.assertEqual({r['state'] for r in db.execute('SELECT state FROM outbox')},{'pending'})

    def test_session_pause_and_uncertain_result_produce_one_notice_each(self):
        self.fixture.adapter.condition='session_paused'
        self.fixture.ingest()
        self.run_worker(deliver=self.deliver)
        self.assertEqual(self.fixture.adapter.submissions,[])
        self.assertEqual(len([m for m in self.messages if m['kind']=='waiting:session_paused']),1)
        self.fixture.adapter.condition='ready'
        self.fixture.adapter.outcome='transport-error'
        self.run_worker(deliver=self.deliver)
        self.assertEqual(len(self.fixture.adapter.submissions),1)
        self.assertEqual(self.executor.list_status()[0]['state'],'uncertain')
        self.run_worker(deliver=self.deliver)
        self.assertEqual(len(self.fixture.adapter.submissions),1)
        self.assertTrue(all(m['recipient']==fixture.e.OWNER for m in self.messages))

    def test_unknown_mail_delivery_is_not_retried_after_restart(self):
        self.fixture.ingest(self.fixture.data(alias='LISTAR'))
        def lost(message):
            self.messages.append(message)
            raise TimeoutError('fixture-provider-result-lost')
        self.run_worker(deliver=lost)
        original=[m['id'] for m in self.messages]
        self.run_worker(deliver=lost)
        self.assertEqual(original,[m['id'] for m in self.messages])
        self.assertEqual(len(set(original)),len(original))
        with self.executor.db() as db:
            self.assertEqual({r['state'] for r in db.execute('SELECT state FROM outbox')},{'uncertain'})

    def test_long_provider_receipt_remains_correlated(self):
        self.fixture.ingest(self.fixture.data(alias='LISTAR'))
        receipt='fixture-'+('x'*212)
        self.run_worker(deliver=lambda message:{'state':'accepted','provider_id':receipt})
        with self.executor.db() as db:
            rows=db.execute('SELECT state,provider_id FROM outbox').fetchall()
        self.assertTrue(rows)
        self.assertTrue(all(row['state']=='accepted' and row['provider_id']==receipt for row in rows))

    def test_unexpected_cycle_failure_exits_without_midloop_recovery(self):
        self.fixture.ingest()
        with patch.object(self.executor,'dispatch_once',side_effect=RuntimeError('fixture-database-unavailable')),patch.object(self.executor,'recover',wraps=self.executor.recover) as recovery:
            result=self.run_worker(deliver=self.deliver)
        self.assertEqual(result['state'],'failed')
        self.assertEqual(result['cycles'],1)
        self.assertEqual(recovery.call_count,1)
        self.assertEqual(self.messages,[])

    def test_global_request_worker_submits_only_to_admin_once(self):
        data=self.fixture.data(alias='GERAL')
        self.fixture.ingest(data)
        self.fixture.ingest(data)
        self.run_worker(deliver=self.deliver)
        self.assertEqual(len(self.fixture.adapter.submissions),1)
        self.assertEqual(self.fixture.adapter.submissions[0][0],self.fixture.config.threads['ADMIN'])
        self.assertFalse(self.fixture.adapter.submission_metadata[0]['children_implemented'])


if __name__=='__main__':unittest.main()
