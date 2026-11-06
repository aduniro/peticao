import unittest,sqlite3,json
from test_data import ReviewFixture
from name_alerts import refresh_alert_queue
from data import decide,listing

class AlertQueueTests(ReviewFixture,unittest.TestCase):
 def test_major_cases_are_queued_once_without_cpf_or_biography(self):
  before=self.item()['decision'];a=refresh_alert_queue(self.db);b=refresh_alert_queue(self.db)
  self.assertEqual(a['pending'],1);self.assertEqual(b['pending'],1);self.assertEqual(a['email_sent'],0)
  with sqlite3.connect(self.db) as db:
   rows=db.execute('SELECT payload FROM name_review_alerts').fetchall();self.assertEqual(len(rows),1)
  payload=rows[0][0];self.assertNotIn('52998224725',payload);self.assertNotIn('MAE FICTICIA',payload);self.assertEqual(self.item()['decision'],before)
 def test_rejection_resolves_notice_without_deleting_record(self):
  refresh_alert_queue(self.db);row=self.item();decide(101,'rejected',row['revision'],'teste',self.db)
  self.assertEqual(refresh_alert_queue(self.db)['pending'],0)
  self.assertEqual(listing({'view':'rejected'},self.db)['total'],1)
