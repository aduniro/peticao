#!/usr/bin/python3
"""Resumo somente leitura da coordenacao: nunca exporta historico bruto ou tokens."""
import datetime,json,sqlite3
from pathlib import Path
BASE=Path('/mnt/apps/peticao-final/_ops/coordenacao-dupla')
def load(path):
 try:return json.loads(path.read_text())
 except (OSError,ValueError):return {}
def collect():
 policy=load(BASE/'policy.json');watch=load(BASE/'state/sessions.json')
 result={'available':False,'enabled':bool(policy.get('hourly_reports',{}).get('enabled')),'observed_at':watch.get('observed_at'),'sessions':watch.get('sessions',[]),'actors':[],'events':[],'leases':[],'pending_ack':[],'policy':'Somente metadados; coleta ativa nao significa agente executando.'}
 dbpath=BASE/'state/coord.sqlite'
 if not dbpath.exists():return result
 try:
  with sqlite3.connect(dbpath.as_uri()+'?mode=ro',uri=True,timeout=5) as db:
   db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
   result['actors']=[dict(r) for r in db.execute('SELECT id,session,repos,registered_at FROM actors ORDER BY id')]
   for row in result['actors']:row['repos']=json.loads(row['repos'])
   result['events']=[dict(r) for r in db.execute('SELECT seq,at,actor,kind,summary,resources FROM events ORDER BY seq DESC LIMIT 25')]
   result['leases']=[dict(r) for r in db.execute("SELECT id,actor,fence,state,expires,operation,resources FROM leases WHERE state IN ('active','uncertain') ORDER BY fence")]
   result['pending_ack']=[dict(r) for r in db.execute('SELECT e.seq,e.actor,e.summary,a.id AS missing_actor FROM events e JOIN actors a ON a.id!=e.actor WHERE e.requires_ack=1 AND NOT EXISTS(SELECT 1 FROM acks k WHERE k.seq=e.seq AND k.actor=a.id) ORDER BY e.seq LIMIT 100')]
   db.rollback()
  result['available']=True
 except (sqlite3.Error,OSError):result['read_error']='Ledger indisponivel nesta captura; estado nao presumido'
 return result
if __name__=='__main__':print(json.dumps(collect(),ensure_ascii=False))
