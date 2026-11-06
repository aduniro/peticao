"""Read-only impact assessment before changing email hash policy. No hash migration."""
import argparse,json,os,sqlite3
from collections import defaultdict
from pathlib import Path
from data import DB,stamp


def canonical(email,legacy=False):
 email=str(email or '').strip().lower()
 if '@' not in email:return email
 local,domain=email.rsplit('@',1)
 if domain in ('gmail.com','googlemail.com'):return local.split('+',1)[0].replace('.','')+'@gmail.com'
 return (local.split('+',1)[0] if legacy else local)+'@'+domain


def audit(database=DB):
 with sqlite3.connect(Path(database).resolve().as_uri()+'?mode=ro',uri=True) as db:
  db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
  records=[dict(json.loads(r[1]),id=r[0]) for r in db.execute('SELECT id,data FROM records WHERE present=1')]
 groups=defaultdict(list)
 for r in records:groups[canonical(r.get('email'),legacy=True)].append(r)
 affected=[dict(id=r['id'],email=r.get('email'),category=r.get('category'),status=r.get('status')) for r in records if canonical(r.get('email'),legacy=True)!=canonical(r.get('email'))]
 collisions=[dict(legacy_key=key,record_ids=[r['id'] for r in rows],delivery_addresses=sorted({r.get('email') or '' for r in rows}),proposed_keys=sorted({canonical(r.get('email')) for r in rows})) for key,rows in groups.items() if len(rows)>1]
 return dict(at=stamp(),read_only=True,records=len(records),non_gmail_plus_affected=len(affected),legacy_collision_groups=len(collisions),affected=affected,collisions=collisions,
  action='Nenhum hash alterado. Não migrar sem verificar a política real dos provedores e os vínculos existentes.')


def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--database',type=Path,default=DB);p.add_argument('--output',type=Path,required=True);args=p.parse_args()
 os.umask(0o077);result=audit(args.database)
 with args.output.open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
 args.output.chmod(0o600)
 print(json.dumps({k:result[k] for k in ('read_only','records','non_gmail_plus_affected','legacy_collision_groups')}))

if __name__=='__main__':main()
