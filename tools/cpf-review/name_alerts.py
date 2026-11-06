"""Local durable review queue; not a mail sender and never writes to the VPS."""
import json
from data import DB,connect,fingerprint,stamp
from name_review import schema,names_for,source_revision,record_from


def refresh_alert_queue(dbpath=DB):
 with connect(dbpath) as db:
  schema(db)
  db.execute('''CREATE TABLE IF NOT EXISTS name_review_alerts(
   fingerprint TEXT PRIMARY KEY,record_id INTEGER NOT NULL REFERENCES records(id),
   source_revision TEXT NOT NULL,policy_version TEXT NOT NULL,payload TEXT NOT NULL,
   state TEXT NOT NULL CHECK(state IN ('pending','resolved')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)''')
  db.execute('BEGIN IMMEDIATE');pending=0;active=set()
  for row in db.execute("SELECT * FROM records WHERE present=1 AND classification IN ('divergencia_forte','divergencia_relevante','ordem_diferente')").fetchall():
   n=names_for(row,db)
   if not n.get('notification_required'):continue
   record=record_from(row);revision=source_revision(record);event=fingerprint([row['id'],revision,n['policy_version']]);active.add(event)
   state='resolved' if row['decision']=='rejected' or row['decision']=='approved' and n['decision']=='approved' else 'pending'
   payload=dict(id=row['id'],seq=record.get('seq'),entered=record.get('name'),api=record.get('nome_api'),proposed=n['proposed'],classification=row['classification'],policy_version=n['policy_version'])
   db.execute('''INSERT INTO name_review_alerts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(fingerprint) DO UPDATE SET
    payload=excluded.payload,state=excluded.state,updated_at=excluded.updated_at''',
    (event,row['id'],revision,n['policy_version'],json.dumps(payload,ensure_ascii=False),state,stamp(),stamp()))
   pending+=state=='pending'
  for event, in db.execute("SELECT fingerprint FROM name_review_alerts WHERE state='pending'").fetchall():
   if event not in active:db.execute("UPDATE name_review_alerts SET state='resolved',updated_at=? WHERE fingerprint=?",(stamp(),event))
 return dict(pending=pending,email_sent=0,delivery='not_enabled_before_deploy')

if __name__=='__main__':print(json.dumps(refresh_alert_queue()))
