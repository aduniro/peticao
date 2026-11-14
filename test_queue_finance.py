import sqlite3
import tempfile
from pathlib import Path
from datetime import datetime, timezone, timedelta
import unittest
from queue_finance import initialize,reserve,release
from financial_guard import deadlines


class AtomicClaim(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/'existing-queue.sqlite'
        self.db=sqlite3.connect(self.path,timeout=0.05);self.addCleanup(self.db.close)
        self.db.execute('CREATE TABLE jobs(id TEXT PRIMARY KEY,state TEXT)')
        self.db.executemany('INSERT INTO jobs VALUES (?,?)',[('job-a','queued'),('job-b','queued')]);self.db.commit()
        initialize(self.db);self.now=datetime(2026,11,14,tzinfo=timezone.utc)
        grant=dict(initial_usd='250',baseline_spent_usd='0',provenance='authenticated_owner',currency='USD',
                   expires_at='2026-12-31T00:00:00Z',account_scope_id='a',grant_evidence_id='g')
        self.schedule=deadlines(grant,dict(currency='USD',complete_mandatory_costs=True,hourly_usd='0.410752'),self.now.isoformat())
        self.charges=dict(grant_initial_usd='250',account_total_usd='170',currency='USD',
                          account_scope_id='a',grant_evidence_id='g',complete_account_scope=True,observed_at=self.now.isoformat())

    def test_rollback_removes_claim_and_money_together(self):
        self.db.execute('BEGIN IMMEDIATE')
        self.assertTrue(reserve(self.db,'vm-a','job-a',self.schedule,self.charges,self.now,4*3600)['allowed'])
        self.db.execute("UPDATE jobs SET state='running' WHERE id='job-a'");self.db.rollback()
        self.assertEqual(self.db.execute("SELECT state FROM jobs WHERE id='job-a'").fetchone()[0],'queued')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM civo_financial_reservations').fetchone()[0],0)

    def test_concurrent_claims_cannot_overbook_same_grant(self):
        other=sqlite3.connect(self.path,timeout=0.01);self.addCleanup(other.close)
        self.db.execute('BEGIN IMMEDIATE')
        self.assertTrue(reserve(self.db,'vm-a','job-a',self.schedule,self.charges,self.now,8*3600)['allowed'])
        with self.assertRaises(sqlite3.OperationalError):other.execute('BEGIN IMMEDIATE')
        self.db.execute("UPDATE jobs SET state='running' WHERE id='job-a'");self.db.commit()
        other.execute('BEGIN IMMEDIATE')
        result=reserve(other,'vm-b','job-b',self.schedule,self.charges,self.now,8*3600)
        self.assertFalse(result['allowed']);other.rollback()

    def test_terminal_job_still_requires_export_before_financial_release(self):
        self.db.execute('BEGIN IMMEDIATE')
        reserve(self.db,'vm-a','job-a',self.schedule,self.charges,self.now,3600)
        self.db.execute("UPDATE jobs SET state='completed' WHERE id='job-a'")
        with self.assertRaises(ValueError):release(self.db,'vm-a','job-a',{},self.now)
        self.assertEqual(self.db.execute('SELECT state FROM civo_financial_reservations').fetchone()[0],'reserved')
        self.db.rollback()

    def test_old_reservation_does_not_bypass_fresh_credit_check(self):
        self.db.execute('BEGIN IMMEDIATE')
        self.assertTrue(reserve(self.db,'vm-a','job-a',self.schedule,self.charges,self.now,3600)['allowed'])
        self.db.commit()
        self.db.execute('BEGIN IMMEDIATE')
        later=self.now+timedelta(hours=2)
        self.assertFalse(reserve(self.db,'vm-a','job-a',self.schedule,self.charges,later,3600)['allowed'])
        self.db.rollback()


if __name__=='__main__':unittest.main()
