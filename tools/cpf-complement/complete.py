#!/usr/bin/env python3
"""Resumable background completion. Writes only private files and the app cache."""
import collections,csv,hashlib,io,json,os,shlex,sqlite3,subprocess,sys,time
from pathlib import Path
sys.path.insert(0,str(Path(__file__).parent))
import cpf_validation_worker as validator
import export_full
from cycle_worker import backup_file,package,save
from cpf_compare import cpf_valid
os.umask(0o077)
job=Path(sys.argv[1]);unit=sys.argv[2]
snapshot=json.loads((job/'snapshot.json').read_text())
forms={r['id']:r for r in snapshot['signatures']}
settings={}
for line in Path('/etc/peticao/app.env').read_text().splitlines():
 k,s,v=line.strip().partition('=')
 if s and k in {'HASH_PEPPER','DATABASE_URL','CPF_CACHE_ENCRYPTION_KEY','CPF_BRASIL_API_KEY'}:
  settings[k]=shlex.split(v,comments=True)[0]
bridge=subprocess.Popen(['node',str(job/'cache-bridge.mjs')],stdin=subprocess.PIPE,stdout=subprocess.PIPE,
 stderr=(job/'bridge.log').open('a'),text=True,bufsize=1,env=dict(os.environ,**settings))
def rpc(q):
 bridge.stdin.write(json.dumps(q)+'\n');bridge.stdin.flush()
 line=bridge.stdout.readline()
 if not line:raise RuntimeError('Cache bridge stopped')
 answer=json.loads(line)
 if answer.get('error'):raise RuntimeError('Cache bridge failed')
 return answer
validator.CACHE=job/'consultas.sqlite'
conn=validator.open_cache()
if not (job/'backup-consultas-anteriores.sqlite').exists():
 backup_file(Path('/root/peticao-recovery/validacao-cpf-brasil-cache.sqlite'),job/'backup-consultas-anteriores.sqlite')
 with sqlite3.connect((job/'backup-consultas-anteriores.sqlite').as_uri()+'?mode=ro',uri=True) as old:
  old.row_factory=sqlite3.Row
  for row in old.execute("SELECT * FROM lookups WHERE status='ok'"):validator.store(conn,dict(row))
network_calls=0;cache_hits=0
original_fetch=validator.fetch
def fetch(cpf,key,opener=None):
 global network_calls,cache_hits
 import hmac
 digest=hmac.new(settings['HASH_PEPPER'].encode(),cpf.encode(),hashlib.sha256).hexdigest()
 hit=rpc({'action':'begin','hash':digest})['record']
 if hit:
  cache_hits+=1;hit.pop('hash',None);return dict(hit,cpf=cpf),False
 try:
  result,halt=original_fetch(cpf,key,opener);network_calls+=1
  if result['status']=='ok':rpc({'action':'put','hash':digest,'record':result})
  else:rpc({'action':'release'})
  return result,halt
 except BaseException:
  rpc({'action':'release'});raise
validator.fetch=fetch
def inputs():
 with sqlite3.connect((job/'recuperacao.sqlite').as_uri()+'?mode=ro',uri=True) as recovery:
  recovered={sid:(cpf,digest) for sid,cpf,digest in recovery.execute('SELECT signature_id,cpf,cpf_hash FROM signatures WHERE cpf IS NOT NULL')}
  meta=dict(recovery.execute('SELECT key,value FROM metadata'))
 entries=[]
 for group,status in [('confirmadas','confirmed'),('pendentes','pending')]:
  rows=[]
  for sid,(cpf,digest) in recovered.items():
   s=forms[sid]
   if s['status']!=status:continue
   row={'assinatura_id':str(sid),'cpf':cpf}
   row.update({label:'' if s.get(field) is None else str(s[field]).lower() if isinstance(s[field],bool) else str(s[field]) for label,field in export_full.FIELDS})
   rows.append(row)
  out=io.StringIO(newline='');writer=csv.DictWriter(out,fieldnames=export_full.HEADERS);writer.writeheader();writer.writerows(rows)
  name='entrada-'+group+'.csv';save(job/name,out.getvalue().encode('utf-8-sig'))
  entries.append({'group':group,'file':name,'source_name':name,'sha256':hashlib.sha256((job/name).read_bytes()).hexdigest(),'rows':len(rows)})
 save(job/'inputs.json',json.dumps(entries).encode())
 return len(recovered),meta
def status(phase,known,**more):
 save(job/'estado-geral.json',json.dumps({'phase':phase,'total_snapshot':len(forms),'cpfs_recuperados':known,'cpfs_restantes':len(forms)-known,'consultas_api_nesta_execucao':network_calls,'reusos_cache_nesta_execucao':cache_hits,**more}).encode())
try:
 while True:
  known,meta=inputs()
  # Populate successes from live cache without another paid request.
  live={r['hash']:r for r in rpc({'action':'dump'})['records']}
  with sqlite3.connect((job/'recuperacao.sqlite').as_uri()+'?mode=ro',uri=True) as recovery:
   for cpf,digest in recovery.execute('SELECT cpf,cpf_hash FROM signatures WHERE cpf IS NOT NULL'):
    if digest in live and not validator.get_record(conn,cpf):
     r=dict(live[digest]);r.pop('hash');validator.store(conn,dict(r,cpf=cpf))
  status('consultando',known)
  validator.process(job,*validator.load_inputs(job),conn)
  errors=conn.execute("SELECT count(*) FROM lookups WHERE status NOT IN ('ok','nao_encontrado','cpf_entrada_invalido')").fetchone()[0]
  finished=meta.get('state') in ('complete','exhausted_with_pending')
  recovery_active=subprocess.run(['systemctl','is-active','--quiet',unit],capture_output=True).returncode==0
  if errors:
   status('pausado_erro_provedor',known,erros=errors);break
  if finished:
   status('complete' if known==len(forms) else 'partial',known);break
  if not recovery_active:
   status('partial_recovery_stopped',known);break
  status('recuperando_cpfs',known)
  # Persist interim files for download while the long search continues.
  time.sleep(30)
finally:
 conn.close();bridge.stdin.close();bridge.wait(timeout=10)
 files=[p for p in (job/'resultados').iterdir() if p.is_file()]
 recovered_export=job/('recuperacao-exportada-'+str(time.time_ns())+'.sqlite')
 backup_file(job/'recuperacao.sqlite',recovered_export)
 files.extend([recovered_export,job/'estado-geral.json'])
 package(job,files,job/'resultado-completo.tar.gz')
