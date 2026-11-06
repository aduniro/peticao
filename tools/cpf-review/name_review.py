"""Independent local print-name decisions, optimistic revisions and audited bulk changes."""
import json,secrets,unicodedata
from data import DB,connect,fingerprint,stamp,listing


def source_revision(record):
 return fingerprint([record.get('cpf_hash',''),record.get('name'),record.get('nome_api')])


def schema(db):
 db.executescript('''CREATE TABLE IF NOT EXISTS name_decisions(
 record_id INTEGER PRIMARY KEY REFERENCES records(id),record_revision TEXT NOT NULL,
 name_revision TEXT NOT NULL,decision TEXT NOT NULL CHECK(decision IN ('pending','approved','rejected')),
 selected_name TEXT,choice TEXT,instruction TEXT,at TEXT NOT NULL,reviewer TEXT NOT NULL,version INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS name_history(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL,
 at TEXT NOT NULL,previous TEXT,current TEXT NOT NULL,reviewer TEXT NOT NULL,batch_id TEXT);
 CREATE TABLE IF NOT EXISTS review_batches(id TEXT PRIMARY KEY,kind TEXT NOT NULL,state TEXT NOT NULL,
 created_at TEXT NOT NULL,payload TEXT NOT NULL,reviewer TEXT,applied_at TEXT);
 ''')


def record_from(row):
 return dict(json.loads(row['data']),cpf_hash=row['cpf_hash'])


def names_for(row,db):
 from name_dictionary import suggest
 data=record_from(row); result=suggest(data); previous=db.execute('SELECT * FROM name_decisions WHERE record_id=?',(row['id'],)).fetchone()
 nr=source_revision(data)
 current=bool(previous and previous['record_revision']==row['revision'] and previous['name_revision']==nr)
 result.update(revision=row['revision'],name_revision=nr,decision=previous['decision'] if current else 'pending',
  selected_name=previous['selected_name'] if previous else None,choice=previous['choice'] if previous else 'proposed',
  instruction=previous['instruction'] if previous else '',version=previous['version'] if previous else 0,
  stale=bool(previous and not current),previous_decision=previous['decision'] if previous else None)
 return result


def get_names(sid,dbpath=DB):
 with connect(dbpath) as db:
  schema(db);row=db.execute('SELECT * FROM records WHERE id=?',(sid,)).fetchone()
  if not row:raise LookupError('Registro não encontrado')
  result=names_for(row,db)
  from name_instructions import proposals_schema
  proposals_schema(db)
  ai=db.execute('SELECT * FROM name_ai_proposals WHERE record_id=? AND record_revision=? AND name_revision=? AND decision_version=? ORDER BY id DESC LIMIT 1',(sid,row['revision'],result['name_revision'],result['version'])).fetchone()
  result['ai_proposal']=dict(ai) if ai else None
  result['history']=[dict(json.loads(r['current']),batch_id=r['batch_id']) for r in db.execute('SELECT current,batch_id FROM name_history WHERE record_id=? ORDER BY id DESC',(sid,))]
  return result


def literal_name(value):
 value=unicodedata.normalize('NFC',str(value or '')).strip()
 if not value or len(value)>300 or any(unicodedata.category(c).startswith('C') for c in value):
  raise ValueError('Informe um nome literal, sem quebras ou caracteres de controle, até 300 caracteres.')
 return ' '.join(value.split())


def write_name(db,row,request,reviewer,batch_id=None):
 value=names_for(row,db)
 if row['revision']!=request.get('revision') or value['name_revision']!=request.get('name_revision'):
  raise RuntimeError('O nome de origem mudou. Atualize antes de decidir.')
 if request.get('version',value['version'])!=value['version']:raise RuntimeError('Outra decisão de nome foi salva. Atualize antes de decidir.')
 decision=request.get('decision');choice=request.get('choice','proposed')
 if decision not in ('pending','approved','rejected'):raise ValueError('Decisão de nome inválida')
 options={'proposed':value['proposed'],'entered':value['entered_resolved'],'api':value['api_resolved'],'custom':request.get('literal')}
 if choice not in options:raise ValueError('Escolha de nome inválida')
 instruction=str(request.get('instruction') or '').strip()
 if len(instruction)>4000:raise ValueError('Instrução longa demais')
 selected=literal_name(options[choice]) if options[choice] else None
 if decision=='approved' and not selected:raise ValueError('Selecione um nome para aprovar')
 if instruction and decision=='approved':raise ValueError('Salve a instrução para análise. A interpretação deve ser apresentada como nome literal e aprovada separadamente.')
 previous=db.execute('SELECT * FROM name_decisions WHERE record_id=?',(row['id'],)).fetchone()
 new=dict(record_id=row['id'],record_revision=row['revision'],name_revision=value['name_revision'],decision=decision,
  selected_name=selected,choice=choice,instruction=instruction,at=stamp(),reviewer=reviewer,version=value['version']+1)
 db.execute('INSERT OR REPLACE INTO name_decisions VALUES(:record_id,:record_revision,:name_revision,:decision,:selected_name,:choice,:instruction,:at,:reviewer,:version)',new)
 db.execute('INSERT INTO name_history(record_id,at,previous,current,reviewer,batch_id) VALUES(?,?,?,?,?,?)',
  (row['id'],stamp(),json.dumps(dict(previous),ensure_ascii=False) if previous else None,json.dumps(new,ensure_ascii=False),reviewer,batch_id))
 return new


def decide_name(sid,request,reviewer,dbpath=DB):
 with connect(dbpath) as db:
  schema(db);db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM records WHERE id=? AND present=1',(sid,)).fetchone()
  if not row:raise LookupError('Registro ausente da fonte atual')
  result=write_name(db,row,request,reviewer)
 return dict(ok=True,**result)


def filtered_rows(db,args):
 clauses=['present=1'];params=[]
 view=args.get('view','pending')
 if view in ('pending','approved','rejected'):clauses.append('decision=?');params.append(view)
 elif view=='active':clauses.append("decision<>'rejected'")
 if not args.get('group'):raise ValueError('Selecione uma categoria antes da ação em grupo')
 clauses.append('classification=?');params.append(args['group'])
 if args.get('status') in ('confirmed','pending'):clauses.append('status=?');params.append(args['status'])
 if args.get('q'):
  from data import norm
  clauses.append('search LIKE ?');params.append('%'+norm(args['q'])+'%')
 return db.execute('SELECT * FROM records WHERE '+' AND '.join(clauses)+' ORDER BY id',params).fetchall()


def bulk_preview(request,dbpath=DB):
 kind=request.get('kind');decision=request.get('decision')
 if kind not in ('cpf','name') or decision not in ('approved','rejected'):raise ValueError('Ação em grupo inválida')
 with connect(dbpath) as db:
  schema(db);db.execute('BEGIN IMMEDIATE');rows=filtered_rows(db,request.get('filters',{}));items=[]
  for row in rows:
   if kind=='cpf':
    if row['decision']!='pending' or json.loads(row['data']).get('category')=='estrangeiro':continue
    items.append(dict(id=row['id'],revision=row['revision'],previous=row['decision'],origin=row['decision_origin'],updated_at=row['updated_at']))
   else:
    n=names_for(row,db)
    if n['decision']!='pending' or n['special'] or n.get('instruction') or not n.get('proposed'):continue
    items.append(dict(id=row['id'],revision=row['revision'],name_revision=n['name_revision'],version=n['version'],proposal=n['proposed'],dictionary_version=n['dictionary_version']))
  token=secrets.token_urlsafe(24);payload=dict(kind=kind,decision=decision,filters=request.get('filters'),items=items)
  db.execute('INSERT INTO review_batches(id,kind,state,created_at,payload) VALUES(?,?,?,?,?)',(token,kind,'preview',stamp(),json.dumps(payload)))
 return dict(token=token,count=len(items),skipped=len(rows)-len(items))


def bulk_apply(token,reviewer,dbpath=DB):
 with connect(dbpath) as db:
  schema(db);db.execute('BEGIN IMMEDIATE');batch=db.execute('SELECT * FROM review_batches WHERE id=?',(token,)).fetchone()
  if not batch or batch['state']!='preview':raise ValueError('Prévia já usada ou inexistente')
  import datetime
  if (datetime.datetime.now(datetime.timezone.utc)-datetime.datetime.fromisoformat(batch['created_at'])).total_seconds()>900:raise ValueError('Prévia expirada; confira a seleção novamente')
  payload=json.loads(batch['payload']);kind=payload['kind']
  for item in payload['items']:
   row=db.execute('SELECT * FROM records WHERE id=? AND present=1',(item['id'],)).fetchone()
   if not row or row['revision']!=item['revision']:raise RuntimeError('Seleção mudou; nenhuma decisão do grupo foi aplicada')
   if kind=='cpf':
    if row['decision']!='pending' or row['updated_at']!=item['updated_at']:raise RuntimeError('Decisão de CPF mudou; confira novamente')
    db.execute('INSERT INTO decisions(record_id,at,previous,current,reviewer,revision,note) VALUES(?,?,?,?,?,?,?)',(row['id'],stamp(),row['decision'],payload['decision'],reviewer,row['revision'],'Lote local '+token))
    item['decision_id']=db.execute('SELECT last_insert_rowid()').fetchone()[0]
    db.execute("UPDATE records SET decision=?,decision_origin='manual',updated_at=? WHERE id=?",(payload['decision'],stamp(),row['id']))
   else:
    n=names_for(row,db)
    if n['version']!=item['version'] or n['name_revision']!=item['name_revision'] or n['special'] or n['proposed']!=item['proposal'] or n['dictionary_version']!=item['dictionary_version']:raise RuntimeError('Sugestão mudou; confira novamente')
    new=write_name(db,row,dict(item,decision=payload['decision'],choice='proposed'),reviewer,token);item['applied_version']=new['version']
  db.execute("UPDATE review_batches SET state='applied',reviewer=?,applied_at=?,payload=? WHERE id=?",(reviewer,stamp(),json.dumps(payload),token))
 return dict(ok=True,batch_id=token,count=len(payload['items']))


def bulk_undo(token,reviewer,dbpath=DB):
 with connect(dbpath) as db:
  schema(db);db.execute('BEGIN IMMEDIATE');batch=db.execute('SELECT * FROM review_batches WHERE id=?',(token,)).fetchone()
  if not batch or batch['state']!='applied':raise ValueError('Lote não disponível para desfazer')
  payload=json.loads(batch['payload'])
  for item in payload['items']:
   row=db.execute('SELECT * FROM records WHERE id=?',(item['id'],)).fetchone()
   if not row or not row['present'] or row['revision']!=item['revision']:raise RuntimeError('Dados mudaram após o lote; nada foi desfeito')
   if payload['kind']=='cpf':
    latest=db.execute('SELECT max(id) FROM decisions WHERE record_id=?',(item['id'],)).fetchone()[0]
    if latest!=item['decision_id'] or row['decision']!=payload['decision']:raise RuntimeError('Há decisão posterior; nada foi desfeito')
    db.execute('INSERT INTO decisions(record_id,at,previous,current,reviewer,revision,note) VALUES(?,?,?,?,?,?,?)',(row['id'],stamp(),row['decision'],item['previous'],reviewer,row['revision'],'Desfeito lote '+token))
    db.execute('UPDATE records SET decision=?,decision_origin=?,updated_at=? WHERE id=?',(item['previous'],item['origin'],stamp(),row['id']))
   else:
    n=names_for(row,db)
    if n['version']!=item['applied_version']:raise RuntimeError('Há decisão de nome posterior; nada foi desfeito')
    previous=db.execute('SELECT previous FROM name_history WHERE record_id=? AND batch_id=? ORDER BY id LIMIT 1',(item['id'],token)).fetchone()
    old=json.loads(previous[0]) if previous and previous[0] else None
    write_name(db,row,dict(revision=row['revision'],name_revision=n['name_revision'],version=n['version'],decision=old['decision'] if old else 'pending',choice=old['choice'] if old else 'proposed',literal=old['selected_name'] if old else None,instruction=old['instruction'] if old else ''),reviewer,'undo:'+token)
  db.execute("UPDATE review_batches SET state='undone' WHERE id=?",(token,))
 return dict(ok=True,count=len(payload['items']))


def instructions(dbpath=DB):
 with connect(dbpath) as db:
  schema(db);rows=db.execute("SELECT r.*,n.instruction FROM records r JOIN name_decisions n ON n.record_id=r.id WHERE r.present=1 AND n.instruction<>''").fetchall()
  return dict(format='name-instructions-v1',records=[dict(id=r['id'],revision=r['revision'],name_revision=source_revision(record_from(r)),version=names_for(r,db)['version'],entered=json.loads(r['data']).get('name'),api=json.loads(r['data']).get('nome_api'),instruction=r['instruction']) for r in rows])
