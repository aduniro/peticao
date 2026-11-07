"""Fixed read-only technical export with replay overlap; never reads contacts or identity values."""
import datetime as dt,json,re,subprocess,uuid
from .store import now
FIELDS={'name','email','cpf','institution','role','campus','city','uf','country','university','consent'}
PHASES={'name','identity','provider','cache','submission'}
CODES={'match','mismatch','partial','complete','identity_required','name_mismatch','locked','unavailable','method_unavailable','bad_input','mock_unknown','not_found','found','hit','miss','bypass','duplicate','recreated','created','queued','sent','send_failed','race_duplicate','ignored'}
REASONS={'spelling_or_different_name','word_boundaries','word_order','extra_words','insufficient_words','match','partial','mismatch','complete'}
def technical_metadata(raw):
 if not isinstance(raw,dict):return {}
 error_fields=raw.get('errorFields',[]);marks=raw.get('marks',[])
 result={'errorFields':[x for x in error_fields if isinstance(x,str) and x in FIELDS] if isinstance(error_fields,list) else [],'marks':[]}
 for item in (marks if isinstance(marks,list) else [])[:20]:
  if not isinstance(item,dict) or item.get('phase') not in PHASES or item.get('code') not in CODES:continue
  mark={'phase':item['phase'],'code':item['code']}
  if item.get('method') in ('nome','mae','nascimento'):mark['method']=item['method']
  analysis=item.get('analysis',{})
  if isinstance(analysis,dict):
   safe={k:v for k,v in analysis.items() if k in ('registryWords','typedWords') and type(v) is int and 0<=v<=80}
   if analysis.get('reason') in REASONS:safe['reason']=analysis['reason']
   if safe:mark['analysis']=safe
  if isinstance(item.get('providerCode'),str) and re.fullmatch(r'(?:HTTP_[45][0-9]{2}|NETWORK|QUOTA|AUTH|TIMEOUT|OTHER)',item['providerCode']):mark['providerCode']=item['providerCode']
  result['marks'].append(mark)
 return result

def query_sql(after):
 timestamp=dt.datetime.fromisoformat(after['ts']).isoformat();identifier=str(uuid.UUID(after['id']))
 return f"""BEGIN READ ONLY;
SET LOCAL statement_timeout='2000ms';
SELECT json_build_object('source_at',clock_timestamp()::text,
 'summary',(SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT source,classification,category,count(*)::int events,count(DISTINCT trace_id)::int attempts FROM signup_diagnostics WHERE ts>now()-interval '24 hours' AND expires_at>now() GROUP BY source,classification,category ORDER BY events DESC) x),
 'records',(SELECT coalesce(json_agg(x),'[]'::json) FROM (SELECT id::text,ts::text,source,classification,category,http_status,duration_ms,left(learning_index,16) AS learning_group,metadata FROM signup_diagnostics WHERE expires_at>now() AND (ts,id)>('{timestamp}'::timestamptz,'{identifier}'::uuid) ORDER BY ts,id LIMIT 500) x));
ROLLBACK;
"""
def remote_query(after):
 script="""import subprocess,json
sql=SQL_PLACEHOLDER
r=subprocess.run(['runuser','-u','postgres','--','psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d','peticao'],input=sql,capture_output=True,text=True,timeout=5)
if r.returncode: print(json.dumps({'available':False}))
else:
 try: print(json.dumps({'available':True,**json.loads(r.stdout.strip())}))
 except ValueError: print(json.dumps({'available':False}))
""".replace('SQL_PLACEHOLDER',repr(query_sql(after)))
 r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=5','peticao-root','python3','-'],input=script,capture_output=True,text=True,timeout=12)
 if r.returncode:raise RuntimeError('Diagnóstico indisponível')
 return json.loads(r.stdout)

def pull(store):
 cursor=store.rows("SELECT value FROM meta WHERE key='diagnostics_cursor'")
 if cursor:
  previous=json.loads(cursor[0]['value']);start=dt.datetime.fromisoformat(previous['ts'])-dt.timedelta(seconds=120)
 else:start=dt.datetime.now(dt.timezone.utc)-dt.timedelta(days=30);previous=None
 after={'ts':start.isoformat(),'id':'00000000-0000-0000-0000-000000000000'};count=0;backlog=False
 for _ in range(20):
  payload=remote_query(after)
  if not payload.get('available'):raise RuntimeError('Tabela de diagnóstico indisponível')
  rows=payload.get('records',[])
  for incoming in rows:
   row=dict(incoming);metadata=row.pop('metadata',{});row['metadata']=technical_metadata(metadata)
   store.event('signup:'+row['classification'],row['classification'],data=row,event_id='signup:'+row['id'])
  count+=len(rows)
  if rows:
   after={'ts':rows[-1]['ts'],'id':rows[-1]['id']}
   if not previous or (dt.datetime.fromisoformat(after['ts']),after['id'])>(dt.datetime.fromisoformat(previous['ts']),previous['id']):store.execute("INSERT OR REPLACE INTO meta VALUES('diagnostics_cursor',?)",(json.dumps(after),))
  if len(rows)<500:break
 else:backlog=True
 payload.pop('records',None);payload.update(imported_records=count,backlog=backlog,overlap_seconds=120)
 store.snapshot('diagnostics',payload,'online')
