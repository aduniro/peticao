#!/usr/bin/python3
"""Teste operacional restrito ao cluster ainda sem fontes reais; suspende somente fila ficticia."""
import json,pathlib,subprocess,uuid,time
from cluster import rpc
BASE=pathlib.Path(__file__).resolve().parent.parent

def remote(host,code):
 r=subprocess.run(['/usr/bin/ssh','-o','BatchMode=yes',host,'/usr/bin/python3 -'],input=code,text=True,capture_output=True,timeout=90)
 if r.returncode:raise RuntimeError(r.stderr or r.stdout)
 return r.stdout.strip()

def main():
 jobs=rpc('santiago',{'action':'jobs'})['result']['jobs']
 if any(j['state'] not in ('completed','failed','canceled','interrupted') for j in jobs):raise SystemExit('Aguardar todos os jobs antes do ensaio')
 approved=json.loads((BASE/'evidencias/npm-fixtures.json').read_text())['commit']
 if any(j.get('source_commit') not in (None,approved) for j in jobs):raise SystemExit('Ensaio recusado: existe fonte real')
 subprocess.run(['/usr/bin/ssh','sonda-verifica3-root','/usr/bin/systemctl start admin-v2-replicate.service'],check=True,timeout=90)
 replica=rpc('sp',{'action':'replica-info'})
 target='/srv/admin-v2-recovery-validation-'+uuid.uuid4().hex
 restored=remote('peticao-root',"import subprocess\nsubprocess.run(['/usr/bin/python3','/opt/admin-v2-cluster/recovery.py','restore','--snapshot',%r,'--target',%r],check=True)"%(replica['path'],target))
 original=remote('sonda-verifica3-root',"import pathlib\nprint(pathlib.Path('/srv/admin-v2-coordinator/authority.json').read_text())")
 authority=json.loads(original)
 proof={'previous_host':'sonda-verifica3','previous_generation':authority['generation'],'new_generation':authority['generation']+1,'method':'coordinator-stopped','verified':True}
 evidence={'restored':restored,'target':target,'replica':replica}
 try:
  evidence['suspension']=remote('sonda-verifica3-root',"import json,pathlib,subprocess\np=pathlib.Path('/srv/admin-v2-coordinator/authority.json');a=json.loads(p.read_text());a['role']='suspended';a['armed_boot_id']=None;p.write_text(json.dumps(a));subprocess.run(['/usr/bin/systemctl','stop','admin-v2-coordinator.service'],check=True);print('test coordinator fenced')")
  evidence['promotion']=remote('peticao-root',"import json,pathlib,subprocess\np=pathlib.Path(%r+'/proof.json');p.write_text(json.dumps(%r));p.chmod(0o600)\nsubprocess.run(['/usr/bin/python3','/opt/admin-v2-cluster/recovery.py','promote','--target',%r,'--fence-proof',str(p),'--verify-fence-command','/usr/local/libexec/admin-v2-verify-fence'],check=True)"%(target,proof,target))
 finally:
  # Remove validation authority before restarting original primary, including partial errors.
  try:remote('peticao-root',"import pathlib,json\np=pathlib.Path(%r+'/authority.json')\na=json.loads(p.read_text());a['role']='suspended';a['armed_boot_id']=None;p.write_text(json.dumps(a));print('validation authority suspended')"%target)
  finally:remote('sonda-verifica3-root',"import pathlib,subprocess\npathlib.Path('/srv/admin-v2-coordinator/authority.json').write_text(%r)\nsubprocess.run(['/usr/bin/systemctl','start','admin-v2-coordinator.service'],check=True);print('original primary restored')"%original)
 evidence['final_santiago']=rpc('santiago',{'action':'health'});evidence['final_sp']=rpc('sp',{'action':'health'})
 (BASE/'evidencias/live-recovery.json').write_text(json.dumps(evidence,indent=2));print(json.dumps(evidence,indent=2))
if __name__=='__main__':main()
