import datetime,hashlib,json,sqlite3,sys,unicodedata,os
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'recovery'))
from cpf_compare import compare,tokens

BASE=Path(os.environ.get('CPF_REVIEW_DATA_DIR','/mnt/dev/cpfs/revisao'))
DB=BASE/'revisao.sqlite'
LABELS={
 'divergencia_forte':'Divergência forte','divergencia_relevante':'Divergência relevante',
 'possivel_erro_de_digitacao':'Possível erro de digitação','ordem_diferente':'Nomes fora de ordem',
 'possivel_nome_incompleto_ou_abreviado':'Nome incompleto ou abreviado','nome_insuficiente':'Nome insuficiente','inconclusivo':'Comparação inconclusiva',
 'nao_encontrado':'CPF não encontrado pela API','sem_consulta':'Sem retorno associado',
 'estrangeiro_sem_cpf':'Exterior — revisão do nome (CPF não aplicável)',
 'erro_consulta':'Consulta com erro ou interrompida','variacao_de_particulas':'Diferença de partículas — válida',
 'coincidencia_exata':'Correspondência exata','coincidencia_normalizada':'Correspondência de nome normalizado'}
VALID={'coincidencia_exata','coincidencia_normalizada','variacao_de_particulas'}
PRIORITY={k:i for i,k in enumerate(LABELS)}
def stamp():return datetime.datetime.now(datetime.timezone.utc).isoformat()
def fingerprint(value):return hashlib.sha256(json.dumps(value,ensure_ascii=False,sort_keys=True).encode()).hexdigest()
def review_revision(cpf_hash,record):return fingerprint([cpf_hash,tokens(record.get('name') or ''),tokens(record['nome_api']) if record.get('nome_api') else None])
def connect(path=DB):
 db=sqlite3.connect(path,timeout=30);db.row_factory=sqlite3.Row;db.execute('PRAGMA foreign_keys=ON');db.execute('PRAGMA journal_mode=WAL')
 db.executescript('''CREATE TABLE IF NOT EXISTS records(
 id INTEGER PRIMARY KEY,cpf_hash TEXT NOT NULL,revision TEXT NOT NULL,data TEXT NOT NULL,
 classification TEXT NOT NULL,priority INTEGER NOT NULL,search TEXT NOT NULL,status TEXT NOT NULL,
 decision TEXT NOT NULL CHECK(decision IN ('pending','approved','rejected')),decision_origin TEXT,
 present INTEGER NOT NULL DEFAULT 1,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS decisions(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL REFERENCES records(id),
 at TEXT NOT NULL,previous TEXT,current TEXT NOT NULL,reviewer TEXT NOT NULL,revision TEXT NOT NULL,note TEXT);
 CREATE TABLE IF NOT EXISTS metadata(key TEXT PRIMARY KEY,value TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS record_versions(id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL,
 received_at TEXT NOT NULL,review_revision TEXT NOT NULL,data TEXT NOT NULL,reason TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS records_filter ON records(present,decision,classification);
 CREATE INDEX IF NOT EXISTS decisions_record ON decisions(record_id,id);''')
 migrated=db.execute("SELECT value FROM metadata WHERE key='review_revision_schema'").fetchone()
 if not migrated or migrated[0]!='name-cpf-v3':
  db.execute('BEGIN IMMEDIATE')
  current=db.execute("SELECT value FROM metadata WHERE key='review_revision_schema'").fetchone()
  if not current or current[0]!='name-cpf-v3':
   for row in db.execute('SELECT id,cpf_hash,data FROM records').fetchall():
    db.execute('UPDATE records SET revision=? WHERE id=?',(review_revision(row['cpf_hash'],json.loads(row['data'])),row['id']))
   db.execute("INSERT OR REPLACE INTO metadata VALUES('review_revision_schema','name-cpf-v3')")
  db.commit()
 return db
def norm(v):return ''.join(c for c in unicodedata.normalize('NFD',str(v).casefold()) if not unicodedata.combining(c))
def query_time(record):
 try:return datetime.datetime.fromisoformat((record.get('queried_at') or '').replace('Z','+00:00')).timestamp()
 except (ValueError,TypeError):return float('-inf')
def newest(candidates):
 valid=[r for r in candidates if r and r.get('status')=='ok' and r.get('name')]
 return max(valid,key=query_time) if valid else next((r for r in candidates if r),None)
def ingest(source,dbpath=DB):
 snapshot=json.loads((source/'signatures.json').read_text());signatures=snapshot.get('signatures')
 if not isinstance(signatures,list):raise ValueError('Snapshot sem lista completa de cadastros')
 ids=[r['id'] for r in signatures]
 if len(ids)!=len(set(ids)):raise ValueError('IDs repetidos no snapshot')
 live={r['hash']:r for r in json.loads((source/'cache.json').read_text())['records']}
 with sqlite3.connect((source/'recuperacao.sqlite').as_uri()+'?mode=ro',uri=True) as c:
  numbers={h:cpf for h,cpf in c.execute('SELECT cpf_hash,cpf FROM signatures WHERE cpf IS NOT NULL')}
 with sqlite3.connect((source/'consultas.sqlite').as_uri()+'?mode=ro',uri=True) as c:
  c.row_factory=sqlite3.Row;lookups={r['cpf']:dict(r) for r in c.execute('SELECT * FROM lookups')}
 allowed=['seq','name','email','category','institution','role','campus','city','uf','country','university',
          'region_declared','region_validated','created_at','consent_at','confirmed_at','status','ip','user_agent','cpf_name_check','identity_method','verify_code','campus_ibge','email_domain_kind']
 changed=0;material=0
 with connect(dbpath) as db:
  db.execute('BEGIN IMMEDIATE')
  previous_at=db.execute("SELECT value FROM metadata WHERE key='source_at'").fetchone()
  if previous_at and datetime.datetime.fromisoformat(snapshot['at'].replace('Z','+00:00'))<datetime.datetime.fromisoformat(previous_at[0].replace('Z','+00:00')):
   raise ValueError('Snapshot antigo recusado; a revisão atual foi preservada')
  existing={r['id']:r for r in db.execute('SELECT * FROM records')}
  seen=set()
  for s in signatures:
   if not s.get('cpf_hash') and s.get('category')!='estrangeiro':continue
   s=dict(s);s['cpf_hash']=s.get('cpf_hash') or ''
   seen.add(s['id'])
   old=existing.get(s['id']);old_data=json.loads(old['data']) if old else {}
   inherited=None
   if not old and s['cpf_hash']:
    inherited=db.execute("SELECT * FROM records WHERE cpf_hash=? AND decision_origin='manual' ORDER BY (SELECT max(at) FROM decisions WHERE record_id=records.id AND reviewer<>'importacao') DESC,updated_at DESC LIMIT 1",(s['cpf_hash'],)).fetchone()
   retained=old_data
   if not retained and inherited:retained=json.loads(inherited['data'])
   same_hash=not old or old['cpf_hash']==s['cpf_hash']
   cpf=numbers.get(s['cpf_hash'],'') or (retained.get('cpf','') if same_hash else '')
   old_lookup={'status':'ok','name':retained.get('nome_api'),'birth':retained.get('nascimento_api'),'mother':retained.get('mae_api'),'sex':retained.get('sexo_api'),'queried_at':retained.get('consulta_em')} if same_hash and retained.get('nome_api') else None
   active=live.get(s['cpf_hash']);historical=lookups.get(cpf)
   lookup=newest([active,historical,old_lookup])
   latest=max([r for r in [active,historical,old_lookup] if r],key=query_time,default=None)
   contradiction=bool(latest and latest.get('status')!='ok' and lookup and lookup.get('status')=='ok' and query_time(latest)>query_time(lookup))
   shown_from_active=bool(active and lookup is active)
   record={k:s.get(k) for k in allowed};record.update(id=s['id'],cpf=cpf,nome_api=None,nascimento_api=None,mae_api=None,sexo_api=None,consulta_em=None)
   result={}
   if lookup and lookup.get('status')=='ok':
    result=old_data.get('comparison') if old_data.get('name')==s['name'] and old_data.get('nome_api')==lookup['name'] else None
    if not result:result=compare(s['name'],lookup['name'])
    classification=result['nome_classificacao']
    record.update(nome_api=lookup['name'],nascimento_api=lookup.get('birth'),mae_api=lookup.get('mother'),sexo_api=lookup.get('sex'),consulta_em=lookup.get('queried_at'))
   elif lookup:classification='nao_encontrado' if lookup['status']=='nao_encontrado' else 'erro_consulta'
   else:classification='estrangeiro_sem_cpf' if s.get('category')=='estrangeiro' else 'sem_consulta'
   record.update(classification=classification,classification_label=LABELS.get(classification,classification),comparison=result,
                 nascimento_informado=None,mae_informada=None,sexo_informado=None,
                 api_cache_ativo=shown_from_active,api_evidencia_historica=bool(lookup and lookup.get('status')=='ok' and not shown_from_active),
                 api_consulta_contraditoria=contradiction,api_ultimo_status=latest.get('status') if latest else None,api_ultima_consulta=latest.get('queried_at') if latest else None,
                 cpf_numero_disponivel=bool(cpf))
   revision=review_revision(s['cpf_hash'],record)
   decision='approved' if classification in VALID else 'pending';origin='comparacao_completa_ou_particulas' if decision=='approved' else None
   if old and old['revision']==revision:decision,origin=old['decision'],old['decision_origin']
   elif old and old['decision_origin']=='manual':
    decision,origin='pending','alteracao_material_revisar';material+=1
    db.execute('INSERT INTO decisions(record_id,at,previous,current,reviewer,revision,note) VALUES(?,?,?,?,?,?,?)',
      (s['id'],stamp(),old['decision'],'pending','importacao',revision,'Nome informado, nome da API ou CPF mudou; decisão anterior e dados preservados no histórico.'))
   elif inherited:
    decision=inherited['decision'] if inherited['revision']==revision else 'pending'
    origin='manual' if inherited['revision']==revision else 'cadastro_refeito_revisar'
   data=json.dumps(record,ensure_ascii=False,sort_keys=True);search=norm(' '.join(str(v or '') for k,v in record.items() if k not in ('comparison','user_agent')))
   if old and old['data']!=data:
    db.execute('INSERT INTO record_versions(record_id,received_at,review_revision,data,reason) VALUES(?,?,?,?,?)',
      (s['id'],stamp(),old['revision'],old['data'],'alteracao_material' if old['revision']!=revision else 'enriquecimento_ou_atualizacao'))
   if not old or old['data']!=data:changed+=1
   if not old or old['data']!=data or old['revision']!=revision or old['decision']!=decision or old['decision_origin']!=origin or not old['present']:
    db.execute('''INSERT INTO records(id,cpf_hash,revision,data,classification,priority,search,status,decision,decision_origin,present,updated_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET
    cpf_hash=excluded.cpf_hash,revision=excluded.revision,data=excluded.data,classification=excluded.classification,
    priority=excluded.priority,search=excluded.search,status=excluded.status,decision=excluded.decision,
    decision_origin=excluded.decision_origin,present=1,updated_at=excluded.updated_at''',
    (s['id'],s['cpf_hash'],revision,data,classification,PRIORITY.get(classification,50),search,s['status'],decision,origin,stamp()))
   if inherited:
    db.execute('INSERT INTO decisions(record_id,at,previous,current,reviewer,revision,note) VALUES(?,?,?,?,?,?,?)',
     (s['id'],stamp(),inherited['decision'],decision,'importacao',revision,'Vinculado ao cadastro anterior ID '+str(inherited['id'])+'; decisão preservada ou devolvida à revisão por mudança dos nomes/CPF.'))
  for sid,old in existing.items():
   if sid not in seen and old['present']:db.execute('UPDATE records SET present=0,updated_at=? WHERE id=?',(stamp(),sid))
  metadata={'source_at':snapshot['at'],'received_at':stamp(),'source_directory':str(source),
            'validation_version':snapshot.get('validation_version','desconhecida'),'source_build_id':snapshot.get('build_id') or '',
            'source_read_only':str(snapshot.get('read_only',False)).lower(),'last_changed_records':str(changed),'last_material_changes':str(material)}
  for key,value in metadata.items():db.execute('INSERT OR REPLACE INTO metadata VALUES(?,?)',(key,value))
 return stats(dbpath)
def stats(dbpath=DB):
 with connect(dbpath) as db:
  groups=[dict(r) for r in db.execute('SELECT classification,count(*) n,sum(decision=\'pending\') pending FROM records WHERE present=1 GROUP BY classification ORDER BY min(priority)')]
  counts={r['decision']:r['n'] for r in db.execute("SELECT decision,count(*) n FROM records WHERE present=1 OR decision='rejected' GROUP BY decision")}
  meta=dict(db.execute('SELECT key,value FROM metadata'))
  return {'groups':groups,'decisions':counts,'source_at':meta.get('source_at'),'received_at':meta.get('received_at'),
          'validation_version':meta.get('validation_version'),'source_build_id':meta.get('source_build_id'),
          'source_read_only':meta.get('source_read_only')=='true','labels':LABELS,
          'review_version':'name-cpf-v3','last_changed_records':int(meta.get('last_changed_records',0))}
def filter_name_decisions(rows,args,db):
 choice=args.get('name_decision','')
 if choice not in ('','pending','approved','rejected','not_approved'):raise ValueError('Filtro de nome inválido')
 if not choice:return rows
 exists=db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='name_decisions'").fetchone()
 previous={r['record_id']:dict(r) for r in db.execute('SELECT * FROM name_decisions')} if exists else {}
 from name_review import source_revision,record_from,names_for
 from name_policy import policy
 from name_dictionary import corpus
 from decision_filter_cache import DecisionFilterCache,DependencyIndex
 version=policy()['version'];policy_key=fingerprint(policy());dependencies=DependencyIndex(corpus());selected=[];cache=DecisionFilterCache(db,DB,BASE)
 for row in rows:
  old=previous.get(row['id']);decision='pending';record=record_from(row) if old else None
  if old and old['record_revision']==row['revision'] and old['name_revision']==source_revision(record):
   decision=old['decision']
   if decision=='approved' and old.get('policy_version')!=version:
    saved=[old.get(k) for k in ('record_revision','name_revision','decision','selected_name','version','policy_version')]
    key=fingerprint(['dependency-v3',row['id'],row['revision'],saved,policy_key,dependencies.record(record)])
    decision=cache.get(key,lambda: names_for(row,db)['decision'])
  if decision==choice or choice=='not_approved' and decision!='approved':selected.append(row)
 cache.flush()
 return selected

def listing(args,dbpath=DB):
 clauses=[];params=[]
 view=args.get('view','pending')
 if view not in ('rejected','all'):clauses.append('present=1')
 if view in ('pending','approved','rejected'):clauses.append('decision=?');params.append(view)
 elif view=='active':clauses.append("decision<>'rejected'")
 elif view=='not_approved':clauses.append("decision<>'approved'")
 if args.get('group'):clauses.append('classification=?');params.append(args['group'])
 if args.get('status') in ('confirmed','pending'):clauses.append('status=?');params.append(args['status'])
 if args.get('q'):clauses.append('search LIKE ?');params.append('%'+norm(args['q'])+'%')
 where=' AND '.join(clauses) or '1=1';page=max(1,int(args.get('page',1)));limit=50
 with connect(dbpath) as db:
  if args.get('name_decision'):
   eligible=filter_name_decisions(db.execute('SELECT * FROM records WHERE '+where+' ORDER BY priority,id',params).fetchall(),args,db)
   total=len(eligible);pages=max(1,(total+limit-1)//limit);page=min(page,pages);rows=eligible[(page-1)*limit:page*limit]
  else:
   total=db.execute('SELECT count(*) FROM records WHERE '+where,params).fetchone()[0]
   pages=max(1,(total+limit-1)//limit);page=min(page,pages)
   rows=db.execute('SELECT * FROM records WHERE '+where+' ORDER BY priority,id LIMIT ? OFFSET ?',params+[limit,(page-1)*limit]).fetchall()
  return {'total':total,'page':page,'limit':limit,'rows':[dict(json.loads(r['data']),decision=r['decision'],revision=r['revision'],decision_origin=r['decision_origin'],present=bool(r['present'])) for r in rows]}
def decide(sid,decision,revision,reviewer,dbpath=DB):
 if decision not in ('approved','rejected','pending'):raise ValueError('Decisão inválida')
 with connect(dbpath) as db:
  db.execute('BEGIN IMMEDIATE');row=db.execute('SELECT * FROM records WHERE id=?',(sid,)).fetchone()
  if not row:raise LookupError('Registro não encontrado')
  if row['revision']!=revision:raise RuntimeError('Os nomes ou CPF mudaram. Atualize a tabela antes de decidir.')
  db.execute('INSERT INTO decisions(record_id,at,previous,current,reviewer,revision) VALUES(?,?,?,?,?,?)',(sid,stamp(),row['decision'],decision,reviewer,revision))
  db.execute("UPDATE records SET decision=?,decision_origin='manual',updated_at=? WHERE id=?",(decision,stamp(),sid))
 return {'ok':True,'id':sid,'decision':decision}
