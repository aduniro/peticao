#!/usr/bin/python3
"""Publica somente resumo operacional do Vigia; nao exporta logs, detalhes ou dados pessoais."""
import pathlib,sqlite3,json,datetime,subprocess,shlex,os
BASE=pathlib.Path(__file__).resolve().parent.parent
DB=pathlib.Path('/mnt/apps/peticao-final/_externos/home/barre/.local/state/peticao-monitor/monitor.sqlite')
def main():
 with sqlite3.connect(DB.as_uri()+'?mode=ro',uri=True,timeout=5) as db:
  db.row_factory=sqlite3.Row
  tables={r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
  tasks=[]
  for row in db.execute("SELECT id,title,state,stage,eta,updated_at FROM tasks WHERE lower(title) LIKE '%admin%' OR id LIKE 'cluster-%' ORDER BY updated_at DESC LIMIT 100"):
   item=dict(row);tid=item['id'];progress=None
   workflow=list(db.execute('SELECT state FROM workflow_steps WHERE task_id=?',(tid,))) if 'workflow_steps' in tables else []
   if workflow:progress=round(100*sum(r['state']=='completed' for r in workflow)/len(workflow),1)
   else:
    steps=[dict(r) for r in db.execute('SELECT id,parent,state,weight FROM steps WHERE task_id=?',(tid,))]
    parents={r['parent'] for r in steps if r['parent']};leaves=[r for r in steps if r['id'] not in parents];weight=sum(r['weight'] for r in leaves)
    if weight>0:progress=round(100*sum(r['weight'] for r in leaves if r['state']=='completed')/weight,1)
   for key,value in item.items():
    if isinstance(value,str):item[key]=''.join(c for c in value if ord(c)>=32)[:1000]
   item['progress']=progress;tasks.append(item)
 payload={'exported_at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':'Vigia local; registros nao comprovam atividade atual','tasks':tasks}
 code="""import pathlib,sys,json,os,grp,uuid
s=json.load(sys.stdin)
if not isinstance(s,dict) or not isinstance(s.get('tasks'),list):raise ValueError('invalid_summary')
p=pathlib.Path('/srv/admin-v2-coordinator/vigia-summary.json');t=p.with_name('.vigia-summary-'+uuid.uuid4().hex)
t.write_text(json.dumps(s,ensure_ascii=False));t.chmod(0o640);os.chown(t,0,grp.getgrnam('admin-v2-exec').gr_gid);t.replace(p)
print(json.dumps({'exported':True,'tasks':len(s['tasks'])}))
"""
 command='/usr/bin/sudo -n /usr/bin/python3 -c '+shlex.quote(code)
 r=subprocess.run(['/usr/bin/ssh','-T','-o','BatchMode=yes','-o','ConnectTimeout=10','cluster-santiago',command],input=json.dumps(payload),capture_output=True,text=True,timeout=30)
 if r.returncode:raise RuntimeError('vigia_summary_export_failed: '+r.stderr[-300:])
 print(r.stdout.strip())
if __name__=='__main__':main()
