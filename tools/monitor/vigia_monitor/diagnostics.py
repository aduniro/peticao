"""Fixed read-only technical aggregates; no app secrets, contacts or identity values."""
import json, subprocess
SQL="""BEGIN READ ONLY;
SET LOCAL statement_timeout='2000ms';
SELECT json_build_object(
 'summary',(SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT source,classification,category,count(*)::int events,count(DISTINCT trace_id)::int attempts FROM signup_diagnostics WHERE ts>now()-interval '24 hours' AND expires_at>now() GROUP BY source,classification,category ORDER BY events DESC) x),
 'records',(SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT id::text,ts::text,source,classification,category,http_status,duration_ms,left(learning_index,16) AS learning_group FROM signup_diagnostics WHERE expires_at>now() ORDER BY ts DESC LIMIT 100) x));
ROLLBACK;
"""
REMOTE="""import subprocess,json
sql=SQL_PLACEHOLDER
r=subprocess.run(['runuser','-u','postgres','--','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d','peticao'],input=sql,capture_output=True,text=True,timeout=5)
if r.returncode: print(json.dumps({'available':False}))
else:
 try: print(json.dumps({'available':True,**json.loads(r.stdout.strip())}))
 except ValueError: print(json.dumps({'available':False}))
""".replace('SQL_PLACEHOLDER',repr(SQL))
def pull(store):
 r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=5','peticao-root','python3','-'],input=REMOTE,capture_output=True,text=True,timeout=12)
 if r.returncode:raise RuntimeError('Diagnóstico indisponível')
 payload=json.loads(r.stdout);store.snapshot('diagnostics',payload,'online' if payload.get('available') else 'unavailable')
 for row in payload.get('records',[]):
  store.event('signup:'+row['classification'],row['classification'],data=row,event_id='signup:'+row['id'])
