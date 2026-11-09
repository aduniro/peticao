"""One atomic mail claim shared by the collector and its independent watchdog."""
import json
import subprocess
from pathlib import Path
from .store import now


def deliver_one(store):
 with store.connect() as db:
  db.execute('BEGIN IMMEDIATE')
  row=db.execute("SELECT * FROM outbox WHERE state='queued' ORDER BY CASE WHEN id LIKE 'stalled:%' THEN 0 ELSE 1 END,at,id LIMIT 1").fetchone()
  if not row:return False
  row=dict(row)
  db.execute("UPDATE outbox SET state='sending',updated_at=? WHERE id=?",(now(),row['id']))
 try:
  result=subprocess.run(['/usr/bin/node',str(Path('/mnt/apps/peticao-final/peticao/tools/monitor/mail.mjs'))],input=json.dumps({'subject':row['subject'],'body':row['body']}),capture_output=True,text=True,timeout=40)
  data=json.loads(result.stdout);status=int(data.get('status',0))
  state='accepted' if result.returncode==0 and 200<=status<300 else 'failed';provider=data.get('id')
 except (OSError,ValueError,TypeError,subprocess.TimeoutExpired):state='uncertain';provider=None
 with store.connect() as db:
  db.execute('UPDATE outbox SET state=?,updated_at=? WHERE id=?',(state,now(),row['id']))
  db.execute('INSERT OR REPLACE INTO mail VALUES(?,?,?,?,?,?)',(provider or row['id'],now(),row['subject'],state,provider,'Aceite do provedor não comprova entrega.'))
 return True
