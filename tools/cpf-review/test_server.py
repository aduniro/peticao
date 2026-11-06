"""HTTP integration against an isolated synthetic database, never the live port."""
import json,os,socket,subprocess,sys,time,urllib.request,urllib.error
from pathlib import Path
from test_data import ReviewTests

class HttpReviewTests(ReviewTests):
 def test_http_name_bulk_and_repeated_previews(self):
  with __import__('sqlite3').connect(self.db) as db:
   db.execute("UPDATE records SET decision='approved',status='confirmed'")
  import sqlite3
  with sqlite3.connect(self.db) as source,sqlite3.connect(self.root/'revisao.sqlite') as target:source.backup(target)
  self.db=self.root/'revisao.sqlite'
  with socket.socket() as sock:sock.bind(('127.0.0.1',0));port=sock.getsockname()[1]
  base=f'http://127.0.0.1:{port}'
  process=subprocess.Popen([sys.executable,str(Path(__file__).with_name('server.py'))],env=dict(os.environ,CPF_REVIEW_DATA_DIR=str(self.root),CPF_REVIEW_PORT=str(port),PYTHONDONTWRITEBYTECODE='1'),stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  try:
   for _ in range(100):
    try:urllib.request.urlopen(base,timeout=.2)
    except urllib.error.HTTPError:break
    except (OSError,TimeoutError):time.sleep(.05)
   token=(self.root/'.access-token').read_text()
   def request(path,body=None,origin=True):
    headers={'Cookie':'review='+token}
    if origin:headers['Origin']=base
    if body is not None:headers['Content-Type']='application/json'
    return json.load(urllib.request.urlopen(urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers=headers),timeout=15))
   listing=request('/api/records?view=all');self.assertEqual(listing['rows'][0]['names']['decision'],'pending')
   n=request('/api/names?id=101')
   with self.assertRaises(urllib.error.HTTPError) as error:request('/api/name-decision',dict(n,id=101,decision='approved',choice='entered'),origin=False)
   self.assertEqual(error.exception.code,403)
   request('/api/name-decision',dict(n,id=101,decision='approved',choice='entered'))
   a=request('/api/preview',{});b=request('/api/preview',{})
   self.assertNotEqual(a['directory'],b['directory']);self.assertTrue(Path(a['pdf']).exists());self.assertTrue(Path(b['pdf']).exists())
   self.assertEqual(request('/api/names?id=101')['decision'],'approved')
   self.assertEqual(request('/api/records?view=all')['rows'][0]['decision'],'approved')
   for path in ['/api/stats','/api/name-instructions']:
    self.assertIsInstance(request(path),dict)
  finally:
   process.terminate();process.wait(timeout=10)
