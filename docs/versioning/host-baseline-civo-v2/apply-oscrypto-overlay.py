#!/usr/bin/env python3
"""Apply the reviewed oscrypto overlay to an explicitly selected isolated venv."""
import argparse,hashlib,json,pathlib,subprocess,shutil
p=argparse.ArgumentParser();p.add_argument('--venv',required=True);a=p.parse_args()
base=pathlib.Path(__file__).resolve().parent
manifest=json.loads((base/'OSCRYPTO-OVERLAY-MANIFEST.json').read_text())
venv=pathlib.Path(a.venv).resolve();assert (venv/'pyvenv.cfg').is_file(),'Isolated venv required'
site=next((venv/'lib').glob('python*/site-packages'));patch=base/'oscrypto-1.3.0-to-upstream-d5f3437.patch'
assert hashlib.sha256(patch.read_bytes()).hexdigest()==manifest['patch_sha256']
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
files={n:site/'oscrypto/_openssl'/n for n in manifest['files']}
current={n:digest(f)for n,f in files.items()}
if all(current[n]==v['after']for n,v in manifest['files'].items()):action='already_applied'
else:
 assert all(current[n]==v['before']for n,v in manifest['files'].items()),'Unexpected or mixed file hashes; refusing overlay'
 backup=venv/'compat-backups/oscrypto-1.3.0';backup.mkdir(parents=True,exist_ok=True)
 for n,f in files.items():
  dst=backup/n
  if dst.exists():assert digest(dst)==manifest['files'][n]['before']
  else:shutil.copy2(f,dst)
 for dry in [True,False]:subprocess.run(['patch','--batch','--fuzz=0','-p1','-i',str(patch)]+(['--dry-run']if dry else []),cwd=site,check=True,capture_output=True)
 action='applied'
assert all(digest(files[n])==v['after']for n,v in manifest['files'].items())
subprocess.run([str(venv/'bin/python'),'-c','import oscrypto.asymmetric,oscrypto.tls,pyhanko.sign.signers,pyhanko.sign.validation'],check=True)
subprocess.run([str(venv/'bin/python'),'-m','pip','check'],check=True)
(venv/'OSCRYPTO-OVERLAY-RECEIPT.json').write_text(json.dumps({'effective_dependency':'oscrypto1.3.0+upstream-d5f3437','action':action,'manifest':manifest},indent=2)+'\n')
print(json.dumps({'overlay':action,'imports':'PASS','pip_check':'PASS'}))
