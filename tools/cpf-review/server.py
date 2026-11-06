#!/usr/bin/env python3
import getpass,hmac,json,os,secrets,sys
from http import cookies
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs,urlparse
from data import BASE,DB,connect,decide,ingest,listing,stats
from name_review import schema,get_names,decide_name,bulk_preview,bulk_apply,bulk_undo,instructions
os.umask(0o077);BASE.mkdir(parents=True,exist_ok=True,mode=0o700);BASE.chmod(0o700)
tokenfile=BASE/'.access-token'
if not tokenfile.exists():tokenfile.write_text(secrets.token_urlsafe(32));tokenfile.chmod(0o600)
TOKEN=tokenfile.read_text();PORT=int(os.environ.get('CPF_REVIEW_PORT','8765'));ROOT=Path(__file__).parent
if not DB.exists():ingest(Path(json.loads((BASE/'fonte-atual.json').read_text())['directory']))
DB.chmod(0o600)
with connect() as db:schema(db)
class Handler(BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def send(self,status,data,kind='application/json; charset=utf-8',headers=None):
  raw=data if isinstance(data,bytes) else json.dumps(data,ensure_ascii=False).encode()
  self.send_response(status);self.send_header('Content-Type',kind);self.send_header('Content-Length',str(len(raw)))
  self.send_header('Cache-Control','no-store');self.send_header('X-Content-Type-Options','nosniff');self.send_header('X-Frame-Options','DENY')
  self.send_header('Referrer-Policy','no-referrer')
  self.send_header('Content-Security-Policy',"default-src 'self'; frame-ancestors 'none'; connect-src 'self'; style-src 'self'; script-src 'self'")
  for k,v in (headers or {}).items():self.send_header(k,v)
  self.end_headers();self.wfile.write(raw)
 def authorized(self):
  if self.headers.get('Host') not in (f'127.0.0.1:{PORT}',f'localhost:{PORT}'):return False
  jar=cookies.SimpleCookie()
  try:jar.load(self.headers.get('Cookie',''))
  except cookies.CookieError:return False
  return hmac.compare_digest(jar['review'].value if 'review' in jar else '',TOKEN)
 def do_GET(self):
  url=urlparse(self.path);args={k:v[0] for k,v in parse_qs(url.query).items()}
  if url.path=='/' and hmac.compare_digest(args.get('token',''),TOKEN):
   return self.send(303,b'',headers={'Set-Cookie':f'review={TOKEN}; HttpOnly; SameSite=Strict; Path=/','Location':'/'})
  if not self.authorized():return self.send(403,{'error':'Abra a revisão pelo comando local.'})
  try:
   if url.path=='/api/records':
    result=listing(args)
    with connect() as db:
     from name_review import names_for
     for row in result['rows']:
      source=db.execute('SELECT * FROM records WHERE id=?',(row['id'],)).fetchone();row['names']=names_for(source,db)
    return self.send(200,result)
   if url.path=='/api/names':return self.send(200,get_names(int(args['id'])))
   if url.path=='/api/name-instructions':return self.send(200,instructions(),headers={'Content-Disposition':'attachment; filename=name-instructions.json'})
   if url.path=='/api/stats':
    from sync import read_state
    with connect() as db:
     name_counts={r['decision']:r['n'] for r in db.execute('SELECT decision,count(*) n FROM name_decisions GROUP BY decision')}
     last=db.execute('SELECT max(id) FROM name_history').fetchone()[0]
    return self.send(200,dict(stats(),sync=read_state(),name_decisions=name_counts,names_updated_at=last))
   if url.path=='/api/history':
    with connect() as db:rows=[dict(r) for r in db.execute('SELECT at,previous,current,reviewer,note FROM decisions WHERE record_id=? ORDER BY id DESC',(int(args['id']),))]
    return self.send(200,rows)
   names={'/':('index.html','text/html; charset=utf-8'),'/app.js':('app.js','text/javascript; charset=utf-8'),'/style.css':('style.css','text/css; charset=utf-8')}
   if url.path in names:
    name,kind=names[url.path];return self.send(200,(ROOT/name).read_bytes(),kind)
   self.send(404,{'error':'Não encontrado'})
  except Exception:self.send(500,{'error':'Não foi possível carregar os dados locais.'})
 def do_POST(self):
  origin=self.headers.get('Origin')
  if not self.authorized() or origin not in (f'http://127.0.0.1:{PORT}',f'http://localhost:{PORT}'):
   return self.send(403,{'error':'Origem não autorizada'})
  try:
   size=int(self.headers.get('Content-Length','0'))
   if size>16384:raise ValueError('Pedido grande demais')
   data=json.loads(self.rfile.read(size))
   if self.path=='/api/name-decision':return self.send(200,decide_name(int(data['id']),data,getpass.getuser()))
   if self.path=='/api/bulk-preview':return self.send(200,bulk_preview(data))
   if self.path=='/api/bulk-apply':return self.send(200,bulk_apply(data['token'],getpass.getuser()))
   if self.path=='/api/bulk-undo':return self.send(200,bulk_undo(data['batch_id'],getpass.getuser()))
   if self.path=='/api/preview':
    from preview import generate
    from data import stamp
    directory=BASE/'previas'/('nomes-'+stamp().replace(':','').replace('+','_')+'-'+secrets.token_hex(3))
    return self.send(200,generate(DB,directory))
   if self.path=='/api/decision':return self.send(200,decide(int(data['id']),data['decision'],data['revision'],getpass.getuser()))
   if self.path=='/api/reload':return self.send(200,ingest(Path(json.loads((BASE/'fonte-atual.json').read_text())['directory'])))
   if self.path=='/api/sync':
    from sync import sync
    return self.send(200,sync())
   self.send(404,{'error':'Não encontrado'})
  except (ValueError,LookupError,RuntimeError) as error:self.send(409,{'error':str(error)})
  except Exception:self.send(500,{'error':'Não foi possível salvar a decisão local.'})
print(f'Revisão local disponível em 127.0.0.1:{PORT}',flush=True)
ThreadingHTTPServer(('127.0.0.1',PORT),Handler).serve_forever()
