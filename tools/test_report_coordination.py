import unittest,tempfile,sqlite3,json,importlib.util,hashlib
from pathlib import Path
SPEC=importlib.util.spec_from_file_location('coord_report',Path(__file__).with_name('collect_report_coordination.py'));M=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(M)
class ReportPrivacyTests(unittest.TestCase):
 def test_read_only_summary_excludes_lease_tokens_and_raw_event_payload(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);(root/'state').mkdir();(root/'policy.json').write_text(json.dumps({'hourly_reports':{'enabled':True}}));(root/'state/sessions.json').write_text(json.dumps({'observed_at':'2026-11-10T00:00:00Z','sessions':[{'actor':'apoio','last_activity_at':'2026-11-09T23:59:00Z','observation_state':'stale'}]}))
   path=root/'state/coord.sqlite'
   with sqlite3.connect(path) as db:
    db.executescript("CREATE TABLE actors(id,session,repos,registered_at);CREATE TABLE events(seq,at,actor,kind,summary,resources,requires_ack,data);CREATE TABLE leases(id,actor,fence,state,expires,operation,resources,token);CREATE TABLE acks(actor,seq,at);")
    db.executemany('INSERT INTO actors VALUES(?,?,?,?)',[('apoio','thread-a','[]','now'),('admin','thread-b','[]','now')]);db.execute('INSERT INTO events VALUES(1,?,?,?,?,?,?,?)',('now','apoio','notice','API compatibilidade','[]',1,'RAW_PAYLOAD_SECRET'));db.execute('INSERT INTO leases VALUES(?,?,?,?,?,?,?,?)',('lease-a','apoio',1,'active',9999999999,'edit','[]','LEASE_SECRET'))
   before=hashlib.sha256(path.read_bytes()).hexdigest();old=M.BASE;M.BASE=root
   try:result=M.collect()
   finally:M.BASE=old
   self.assertTrue(result['enabled']);self.assertTrue(result['available']);self.assertEqual(result['pending_ack'][0]['missing_actor'],'admin');self.assertNotIn('LEASE_SECRET',json.dumps(result));self.assertNotIn('RAW_PAYLOAD_SECRET',json.dumps(result));self.assertEqual(before,hashlib.sha256(path.read_bytes()).hexdigest())
 def test_missing_ledger_does_not_invent_activity(self):
  with tempfile.TemporaryDirectory() as d:
   old=M.BASE;M.BASE=Path(d)
   try:r=M.collect()
   finally:M.BASE=old
   self.assertFalse(r['available']);self.assertEqual(r['sessions'],[])
if __name__=='__main__':unittest.main()
