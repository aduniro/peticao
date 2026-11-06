import unittest,json,sqlite3
from test_data import ReviewFixture
from audit_email import audit,canonical

class EmailImpactTests(ReviewFixture,unittest.TestCase):
 def test_reports_legacy_alias_collision_without_writing(self):
  with sqlite3.connect(self.db) as db:
   first=json.loads(db.execute('SELECT data FROM records WHERE id=101').fetchone()[0]);first['email']='pessoa+um@example.org'
   db.execute('UPDATE records SET data=? WHERE id=101',(json.dumps(first),))
   second=dict(first,id=102,email='pessoa+dois@example.org')
   db.execute('INSERT INTO records SELECT 102,cpf_hash,revision,?,classification,priority,search,status,decision,decision_origin,present,updated_at FROM records WHERE id=101',(json.dumps(second),))
   before=db.execute('SELECT * FROM records ORDER BY id').fetchall()
  result=audit(self.db);self.assertEqual(result['non_gmail_plus_affected'],2);self.assertEqual(result['legacy_collision_groups'],1)
  with sqlite3.connect(self.db) as db:self.assertEqual(before,db.execute('SELECT * FROM records ORDER BY id').fetchall())
 def test_canonical_boundary_is_only_personal_gmail(self):
  self.assertEqual(canonical('Joao.Silva+um@googlemail.com'),'joaosilva@gmail.com')
  self.assertNotEqual(canonical('joao.silva@university.example'),canonical('joaosilva@university.example'))
