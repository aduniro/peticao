import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from vigia_monitor.store import Store
from vigia_monitor.mail_policy import QUIET_KEY,SUMMARY_KEY,suppress_mail,hourly_tree_owns_summary


def test_quiet_retires_old_notifications_without_losing_events(tmp_path):
 s=Store(tmp_path/'monitor.sqlite');s.queue_mail('old','Aviso fictício','Evento fictício')
 s.event('fixture','Evento preservado')
 s.execute('INSERT INTO meta VALUES(?,?)',(QUIET_KEY,'2026-11-10T11:00:00Z'))
 with s.connect() as db:
  row=dict(db.execute('SELECT * FROM outbox').fetchone())
  assert suppress_mail(db,row,'2026-11-10T10:59:00Z')
 assert s.rows('SELECT state FROM outbox')[0]['state']=='suppressed'
 assert s.rows('SELECT state FROM mail')[0]['state']=='suppressed'
 assert len(s.rows('SELECT * FROM events'))==1


def test_after_seven_does_not_drain_overnight_backlog_but_new_alerts_resume(tmp_path):
 s=Store(tmp_path/'monitor.sqlite');s.execute('INSERT INTO meta VALUES(?,?)',(QUIET_KEY,'2026-11-10T11:00:00Z'))
 s.queue_mail('old','Antigo','Fictício');s.queue_mail('new','Novo','Fictício')
 s.execute("UPDATE outbox SET at='2026-11-10T10:00:00Z' WHERE id='old'")
 s.execute("UPDATE outbox SET at='2026-11-10T11:01:00Z' WHERE id='new'")
 with s.connect() as db:
  assert suppress_mail(db,dict(db.execute("SELECT * FROM outbox WHERE id='old'").fetchone()),'2026-11-10T11:02:00Z')
  assert not suppress_mail(db,dict(db.execute("SELECT * FROM outbox WHERE id='new'").fetchone()),'2026-11-10T11:02:00Z')


def test_hourly_owner_only_suppresses_summary_not_incident_delivery(tmp_path):
 s=Store(tmp_path/'monitor.sqlite');assert not hourly_tree_owns_summary(s)
 s.execute('INSERT INTO meta VALUES(?,?)',(SUMMARY_KEY,'1'))
 assert hourly_tree_owns_summary(s)
 s.queue_mail('incident','Incidente','Fictício')
 with s.connect() as db:assert not suppress_mail(db,dict(db.execute('SELECT * FROM outbox').fetchone()),'2026-11-10T12:00:00Z')
