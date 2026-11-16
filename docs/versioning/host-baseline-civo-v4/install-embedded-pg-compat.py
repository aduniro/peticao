#!/usr/bin/env python3
"""Install the pinned ICU60 compatibility dependency in a project prefix only."""
import argparse,pathlib,json,hashlib,urllib.request,subprocess,os,shlex
ap=argparse.ArgumentParser();ap.add_argument('--prefix',required=True);ap.add_argument('--node-modules');a=ap.parse_args()
P=pathlib.Path(a.prefix).resolve();N=pathlib.Path(a.node_modules).resolve()if a.node_modules else P/'dependencies/node_modules'
assert P not in map(pathlib.Path,['/','/usr','/usr/local','/opt','/etc','/lib','/lib64']), 'Project prefix required'
package=N/'@embedded-postgres/linux-x64';meta=json.loads((package/'package.json').read_text());assert meta['version']=='18.4.0-beta.17'
sha='f01f61f57e63dc905e02e6441d10370fe0c79e43e70e6f5fe24b342fd2633209';url='https://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu60_60.2-3ubuntu3.2_amd64.deb'
art=P/'artifacts';art.mkdir(parents=True,exist_ok=True);deb=art/url.rsplit('/',1)[1]
if not deb.exists():
 raw=urllib.request.urlopen(url,timeout=60).read();assert hashlib.sha256(raw).hexdigest()==sha;deb.write_bytes(raw)
assert hashlib.sha256(deb.read_bytes()).hexdigest()==sha
D=P/'compat/icu60';D.mkdir(parents=True,exist_ok=True)
subprocess.run(['dpkg-deb','-x',str(deb),str(D)],check=True)
lib=D/'usr/lib/x86_64-linux-gnu';B=package/'native/bin';env=dict(os.environ,LD_LIBRARY_PATH=str(lib))
r=subprocess.run([str(B/'postgres'),'--version'],env=env,capture_output=True,text=True);assert r.returncode==0,r.stderr
ldd=subprocess.run(['ldd',str(B/'postgres')],env=env,capture_output=True,text=True);assert ldd.returncode==0 and 'not found'not in ldd.stdout
bin=P/'bin';bin.mkdir(exist_ok=True)
for name,cmd in [('with-embedded-pg18','"$@"')]+[(tool+'18',shlex.quote(str(B/tool))+' "$@"')for tool in ['postgres','initdb','pg_ctl']]:
 f=bin/name;content='#!/bin/sh\nexec env LD_LIBRARY_PATH='+shlex.quote(str(lib))+'${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH} '+cmd+'\n'
 # Existing destination wrappers may include comments; replace only same-profile known paths.
 if f.exists():assert str(lib)in f.read_text()and ('with-embedded' in name or str(B)in f.read_text()),'Unrelated wrapper exists'
 f.write_text(content);f.chmod(0o755)
result={'package':'libicu60','version':'60.2-3ubuntu3.2','sha256':sha,'url':url,'prefix':str(D),'node_package':'18.4.0-beta.17','postgres_version':r.stdout.strip(),'LD_LIBRARY_PATH_scope':'Only explicit wrapper command and descendants; never global','native_OS_unchanged':True,'full_local_start_stop_smoke_required':True}
(D/'INSTALL-RECEIPT.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
