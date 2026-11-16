#!/usr/bin/env python3
"""Private compatibility aliases for the canonical embedded PG18 npm runtime."""
import argparse,pathlib,json,hashlib,urllib.request,subprocess,os,shlex,re
ap=argparse.ArgumentParser();ap.add_argument('--prefix',required=True);ap.add_argument('--node-modules');a=ap.parse_args()
P=pathlib.Path(a.prefix).resolve();N=pathlib.Path(a.node_modules).resolve()if a.node_modules else P/'dependencies/node_modules'
assert P not in map(pathlib.Path,['/','/usr','/usr/local','/opt','/etc','/lib','/lib64']), 'Project prefix required'
package=N/'@embedded-postgres/linux-x64';meta=json.loads((package/'package.json').read_text());assert meta['version']=='18.4.0-beta.17'
L=package/'native/lib';B=package/'native/bin'
pins={'libpq.so.5.18':'fc25b6ab756b056aba0c4df23d5504db65fa9125ea309ceafb199bc546d785ee','libssl.so.1.1':'85582cf361e8942ea6602a633d6fe33ebfd404edebaa907d060d9c705e86c3d4','libcrypto.so.1.1':'89a2227a7731df9a95135e5d43d0c1b73af01c45842e482eb4a1e16121b1b6aa'}
def digest(f):return hashlib.sha256(f.read_bytes()).hexdigest()
for n,h in pins.items():assert digest(L/n)==h,'Unexpected canonical bundled library: '+n
icu={'libicui18n.so.60.2':'0e0e144ee7e0251725cb736e600b05ba16cff8fd7e63b6b18fe0a3d57b09de7f','libicuuc.so.60.2':'608238deca39ccd769b87b6835d353c017dc5f01a79c7e8bb753000bb8c08a9a','libicudata.so.60.2':'e03e645c9a71a5c173b356f1183e38f70001d417597f3459851a1c1d3c38bd5e'}
D=P/'compat/icu60';I=D/'usr/lib/x86_64-linux-gnu';debsha='f01f61f57e63dc905e02e6441d10370fe0c79e43e70e6f5fe24b342fd2633209';url='https://archive.ubuntu.com/ubuntu/pool/main/i/icu/libicu60_60.2-3ubuntu3.2_amd64.deb'
if not all((I/n).is_file()and digest(I/n)==h for n,h in icu.items()):
 assert not D.exists()or not any(D.iterdir()),'Existing ICU prefix differs; refusing overwrite'
 art=P/'artifacts';art.mkdir(parents=True,exist_ok=True);deb=art/url.rsplit('/',1)[1]
 if not deb.exists():
  raw=urllib.request.urlopen(url,timeout=60).read();assert hashlib.sha256(raw).hexdigest()==debsha;deb.write_bytes(raw)
 assert digest(deb)==debsha;D.mkdir(parents=True,exist_ok=True);subprocess.run(['dpkg-deb','-x',str(deb),str(D)],check=True)
for n,h in icu.items():assert digest(I/n)==h
S=P/'compat/embedded-pg18-sonames';S.mkdir(parents=True,exist_ok=True);alias=S/'libpq.so.5';target=(L/'libpq.so.5.18').resolve()
if alias.is_symlink():assert alias.resolve()==target,'Unexpected existing private SONAME alias'
else:
 assert not alias.exists(),'Unrelated SONAME path exists';alias.symlink_to(target)
loader=':'.join(map(str,[S,I,L]));env=dict(os.environ,LD_LIBRARY_PATH=loader);closure={}
for tool in ['postgres','initdb','pg_ctl']:
 r=subprocess.run(['ldd',str(B/tool)],env=env,capture_output=True,text=True);assert r.returncode==0 and 'not found'not in r.stdout,(tool,r.stdout,r.stderr);closure[tool]=r.stdout
 r=subprocess.run([str(B/tool),'--version'],env=env,capture_output=True,text=True);assert r.returncode==0,(tool,r.stderr)
match=re.search(r'libpq\.so\.5 => (\S+)',closure['initdb']);assert match and pathlib.Path(match[1])==alias and pathlib.Path(match[1]).resolve()==target,'Native LIBPQ masking detected'
bin=P/'bin';bin.mkdir(exist_ok=True)
for name,cmd in [('with-embedded-pg18','"$@"')]+[(tool+'18',shlex.quote(str(B/tool))+' "$@"')for tool in ['postgres','initdb','pg_ctl']]:
 f=bin/name;content='#!/bin/sh\n# Private PG loader only; no global exports.\nexec env LD_LIBRARY_PATH='+shlex.quote(loader)+' '+cmd+'\n'
 if f.exists():assert str(I)in f.read_text()and ('with-embedded'in name or str(B)in f.read_text()),'Unrelated wrapper exists'
 f.write_text(content);f.chmod(0o755)
for n,h in pins.items():assert digest(L/n)==h
result={'revision':5,'canonical_npm_package':'18.4.0-beta.17','private_libpq_path':str(alias),'private_libpq_target':str(target),'bundled_library_pins':pins,'icu_pins':icu,'icu_deb_sha256':debsha,'LD_LIBRARY_PATH':loader,'scope':'Only PG command and descendants; never global/OS/A1','closure':closure,'native_libpq_masking_excluded':True,'no_node_modules_or_OS_changes':True,'full_local_sql_start_stop_smoke_required':True}
(S/'INSTALL-RECEIPT-v5.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))
