"""Canonical-queue fixtures with local child; units/transport are synthetic."""
import hashlib
from pathlib import Path
import sqlite3
import sys
import unittest

DEPENDENCY=Path(__file__).parent/'integration/runtime3116'
sys.path.insert(0,str(DEPENDENCY))
import test_runtime as fixtures
import launch_tokens as tokens
from test_launch_tokens import fixture_root


class RuntimeIntegration(unittest.TestCase):
    def setUp(self):
        self.runtime=fixtures.RuntimeTests();self.runtime.setUp()
        self.root=self.runtime.root/'launch-envelopes';self.root.mkdir(mode=0o700)
        self.store=tokens.TokenStore(self.root,validator=fixture_root,allowed_root=self.runtime.root)
        self.manifest=self.runtime.manifest

    def tearDown(self):
        self.store.close();self.runtime.tearDown()

    def test_envelope_precedes_claim_then_actual_child_result_custody(self):
        secret=self.store.prepare(self.manifest)
        with sqlite3.connect(self.runtime.queue) as db:
            self.assertEqual(db.execute('SELECT count(*) FROM remote_execution_claims').fetchone()[0],0)
        self.runtime.backend.dispatch(self.manifest,secret.value_for_dispatch())
        result=self.runtime.backend.finish(self.manifest)
        self.assertEqual(result['state'],'completed');self.assertEqual(self.runtime.state(),'completed')
        with sqlite3.connect(self.runtime.queue) as db:
            sha=db.execute('SELECT token_sha256 FROM remote_execution_claims WHERE job_id=?',(self.manifest['job_id'],)).fetchone()[0]
            self.assertEqual(sha,self.store.metadata(self.manifest)['token_sha256'])
            self.assertNotEqual(sha,secret.value_for_dispatch())
            self.assertEqual(db.execute("SELECT state FROM jobs WHERE id=?",('f'*32,)).fetchone()[0],'completed')
            self.assertEqual(db.execute("SELECT count(*) FROM events WHERE kind='legacy'").fetchone()[0],1)
        self.assertEqual((self.runtime.adapter.starts,self.runtime.adapter.stops),(1,1))

    def test_lost_start_reply_never_regenerates_or_relaunches(self):
        secret=self.store.prepare(self.manifest)
        self.runtime.transport.lose='start'
        with self.assertRaises(TimeoutError):self.runtime.backend.dispatch(self.manifest,secret.value_for_dispatch())
        with self.assertRaises(FileExistsError):self.store.prepare(self.manifest)
        recovered=self.store.load(self.manifest)
        self.assertEqual(recovered.sha256(),secret.sha256())
        before=len(self.runtime.transport.calls)
        with self.assertRaises(RuntimeError):self.runtime.backend.dispatch(self.manifest,recovered.value_for_dispatch())
        self.assertEqual(len(self.runtime.transport.calls),before)
        self.runtime.backend.observe(self.manifest)
        self.assertEqual(self.runtime.backend.finish(self.manifest)['state'],'completed')
        self.assertEqual(self.runtime.adapter.starts,1)

    def test_recovery_before_queue_claim_reuses_prepared_envelope(self):
        secret=self.store.prepare(self.manifest);self.store.close()
        self.store=tokens.TokenStore(self.root,validator=fixture_root,allowed_root=self.runtime.root)
        recovered=self.store.load(self.manifest)
        self.assertEqual(secret.sha256(),recovered.sha256())
        self.runtime.backend.dispatch(self.manifest,recovered.value_for_dispatch())
        self.assertEqual(self.runtime.backend.finish(self.manifest)['state'],'completed')
        self.assertEqual(self.runtime.adapter.starts,1)


if __name__=='__main__':unittest.main()
