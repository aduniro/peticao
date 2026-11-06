"""Export local instructions or import reviewed AI proposals; never auto-approve."""
import argparse,json
from pathlib import Path
from data import DB,connect,stamp
from name_review import schema,instructions,names_for


def proposals_schema(db):
 db.execute('''CREATE TABLE IF NOT EXISTS name_ai_proposals(
 id INTEGER PRIMARY KEY,record_id INTEGER NOT NULL REFERENCES records(id),
 record_revision TEXT NOT NULL,name_revision TEXT NOT NULL,decision_version INTEGER NOT NULL,
 literal TEXT NOT NULL,explanation TEXT NOT NULL,uncertainty TEXT NOT NULL,at TEXT NOT NULL)''')


def import_proposals(items,dbpath=DB):
 from name_review import literal_name
 if not isinstance(items,list) or not items or len(items)>1000:raise ValueError('Esperada lista de 1 a 1000 propostas')
 ids=[x['id'] for x in items]
 if len(ids)!=len(set(ids)):raise ValueError('IDs repetidos')
 with connect(dbpath) as db:
  schema(db);proposals_schema(db);db.execute('BEGIN IMMEDIATE')
  for item in items:
   row=db.execute('SELECT * FROM records WHERE id=? AND present=1',(item['id'],)).fetchone()
   if not row:raise ValueError('Registro não está presente na origem atual')
   n=names_for(row,db)
   if item.get('revision')!=row['revision'] or item.get('name_revision')!=n['name_revision'] or item.get('version')!=n['version']:raise ValueError('Dados ou decisão mudaram; reexporte as instruções')
   literal=literal_name(item.get('literal'));explanation=str(item.get('explanation','')).strip();uncertainty=str(item.get('uncertainty','')).strip()
   if not explanation or not uncertainty or len(explanation)>4000 or len(uncertainty)>2000:raise ValueError('Explique a interpretação e suas incertezas')
   db.execute('INSERT INTO name_ai_proposals(record_id,record_revision,name_revision,decision_version,literal,explanation,uncertainty,at) VALUES(?,?,?,?,?,?,?,?)',(row['id'],row['revision'],n['name_revision'],n['version'],literal,explanation,uncertainty,stamp()))
 return {'imported':len(items),'auto_approved':0}


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--database',type=Path,default=DB);p.add_argument('--export',type=Path);p.add_argument('--import-proposals',type=Path);args=p.parse_args()
 if bool(args.export)==bool(args.import_proposals):p.error('Escolha exportar ou importar')
 if args.export:
  import os
  os.umask(0o077)
  with args.export.open('x') as f:json.dump(instructions(args.database),f,ensure_ascii=False,indent=2)
  print('Instruções exportadas para '+str(args.export.resolve()))
 else:print(json.dumps(import_proposals(json.loads(args.import_proposals.read_text()),args.database)))

if __name__=='__main__':main()
