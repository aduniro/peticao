#!/usr/bin/python3
"""Single scheduled owner: legacy email drain, admin-v2 batch/tick operations."""
import json,os,sys,urllib.request,urllib.error
from pathlib import Path
class NoRedirect(urllib.request.HTTPRedirectHandler):
 def redirect_request(self,*args,**kwargs):return None

def execute(task,port,host,secret,opener,timeout=170):
 req=urllib.request.Request(f'http://127.0.0.1:{port}/api/cron/{task}',data=b'',headers={'Authorization':'Bearer '+secret,'Host':host},method='POST')
 try:
  with opener.open(req,timeout=timeout) as response:
   if response.status!=200:raise RuntimeError('unexpected_status')
   body=response.read(1024*1024+1)
   if len(body)>1024*1024:raise RuntimeError('response_limit')
   json.loads(body)
  print(json.dumps({'task':task,'port':port,'httpStatus':200,'ok':True}),flush=True);return True
 except urllib.error.HTTPError as e:
  print(json.dumps({'task':task,'port':port,'ok':False,'httpStatus':e.code}),file=sys.stderr,flush=True)
 except Exception:
  print(json.dumps({'task':task,'port':port,'ok':False,'error':'request_failed_or_result_uncertain'}),file=sys.stderr,flush=True)
 return False

def main():
 secret=(Path(os.environ['CREDENTIALS_DIRECTORY'])/'cron-secret').read_text()
 if not secret or any(c in secret for c in '\r\n'):raise RuntimeError('invalid_cron_credential')
 opener=urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect())
 # Each task is submitted once. The applications own durable claim/reconciliation.
 outcomes=[execute('fila',3000,'sancionaintegral.org',secret,opener),execute('fila',3001,'admin.sancionaintegral.org',secret,opener),execute('tick',3001,'admin.sancionaintegral.org',secret,opener),execute('a1',3001,'admin.sancionaintegral.org',secret,opener,timeout=110)]
 return 0 if all(outcomes) else 1
if __name__=='__main__':
 try:sys.exit(main())
 except Exception:print('{"ok":false,"error":"scheduler_configuration_failed"}',file=sys.stderr);sys.exit(1)
