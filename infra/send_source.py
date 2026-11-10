#!/usr/bin/python3
"""Exporta somente um commit explicito; enviar exige --send apos checkpoint do agente."""
import argparse,subprocess,pathlib,json,hashlib,base64,re,io,tarfile
from cluster import rpc
p=argparse.ArgumentParser(description=__doc__);p.add_argument('--repo',required=True);p.add_argument('--commit',required=True);p.add_argument('--send',action='store_true');a=p.parse_args()
repo=pathlib.Path(a.repo)
if not repo.is_absolute() or not re.fullmatch('[0-9a-f]{40}',a.commit):raise SystemExit('Use repositorio absoluto e commit completo de 40 caracteres')
subprocess.run(['/usr/bin/git','-C',str(repo),'cat-file','-e',a.commit+'^{commit}'],check=True)
archive=subprocess.check_output(['/usr/bin/git','-C',str(repo),'archive','--format=tar.gz',a.commit])
if len(archive)>64*1024**2:raise SystemExit('Arquivo excede 64 MiB')
files=[]
with tarfile.open(fileobj=io.BytesIO(archive),mode='r:gz') as tf:
 for m in tf:
  parts=pathlib.PurePosixPath(m.name).parts
  if m.issym() or m.islnk() or not(m.isdir() or m.isfile()):raise SystemExit('Link/arquivo especial recusado: '+m.name)
  if any(x in ('.git','node_modules','.next','secrets','preview-state','.pgdata','pgdata') or (x.startswith('.env') and x not in ('.env.example','.env.sample')) for x in parts):raise SystemExit('Caminho de runtime/segredo recusado: '+m.name)
  files.append(m.name)
result={'repo':str(repo),'commit':a.commit,'sha256':hashlib.sha256(archive).hexdigest(),'archive_bytes':len(archive),'files':len(files),'sent':False,'note':'O commit deve ser previamente revisado quanto a segredos; nomes nao detectam conteudo secreto.'}
if a.send:
 result['response']=rpc('santiago',{'action':'import-source','commit':a.commit,'sha256':result['sha256'],'archive_base64':base64.b64encode(archive).decode()});result['sent']=True
print(json.dumps(result,ensure_ascii=False,indent=2))
