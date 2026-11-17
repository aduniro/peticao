"""Per-account isolated CLI installer; JSON input on stdin, safe metadata output."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import platform
import shlex
import shutil
import subprocess
import sys
import time
import urllib.request
import uuid
import zipfile


def private_write(path,content):
    path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_TRUNC,0o600)
    with os.fdopen(fd,'w') as f:f.write(content)


def install(payload):
    os.umask(0o077)
    home=Path.home();root=home/'.local/share/peticao/databases'
    config=home/'.config/peticao/databases';release=root/'releases'/payload['release']
    free=shutil.disk_usage(home).free
    minimum=3*1024**3 if payload.get('waha') else 512*1024**2
    if free<minimum+128*1024**2:raise RuntimeError('insufficient_disk_margin')
    if sys.version_info[:2] not in [(3,11),(3,12),(3,13)]:raise RuntimeError('unsupported_python')
    for name,settings in payload['configs'].items():
        p=config/name
        if p.is_symlink():raise RuntimeError('config_symlink_refused')
        if p.exists():
            old=json.loads(p.read_text())
            if old.get('branch_id')!=settings['branch_id'] or old.get('role')!=settings['role']:raise RuntimeError('existing_profile_conflict')
    wrapper=home/'.local/bin/peticao-tasks'
    if wrapper.exists() and 'peticao-coordination-profile' not in wrapper.read_text():raise RuntimeError('existing_wrapper_conflict')
    release.mkdir(mode=0o700,parents=True,exist_ok=True)
    for name,content in payload['files'].items():
        if '/' in name or name.startswith('.'):raise ValueError('invalid_bundle_filename')
        private_write(release/name,content)
    venv=release/'venv'
    env=dict(os.environ,PYTHONNOUSERSITE='1');env.pop('PYTHONPATH',None)
    if not (venv/'bin/python').exists():
        r=subprocess.run([sys.executable,'-m','venv','--without-pip',str(venv)],capture_output=True,text=True,env=env)
        if r.returncode:raise RuntimeError('venv_creation_failed')
    py=venv/'bin/python'
    site_path=Path(subprocess.check_output([str(py),'-c','import sysconfig;print(sysconfig.get_paths()["purelib"])'],text=True,env=env).strip())
    tag='cp'+str(sys.version_info.major)+str(sys.version_info.minor);arch=platform.machine()
    cache=root/'wheel-cache';cache.mkdir(mode=0o700,parents=True,exist_ok=True)
    selected=[]
    for package in payload['dependencies']['packages']:
        matches=[w for w in package['wheels'] if package['package']!='psycopg-binary' or (tag+'-'+tag in w['filename'] and arch in w['filename'])]
        if len(matches)!=1:raise RuntimeError('ambiguous_or_missing_wheel')
        wheel=matches[0];target=cache/wheel['filename']
        if not target.exists():
            with urllib.request.urlopen(wheel['source'],timeout=45) as r:data=r.read()
            if hashlib.sha256(data).hexdigest()!=wheel['sha256']:raise RuntimeError('wheel_checksum_mismatch')
            target.write_bytes(data);target.chmod(0o600)
        if hashlib.sha256(target.read_bytes()).hexdigest()!=wheel['sha256']:raise RuntimeError('cached_wheel_checksum_mismatch')
        with zipfile.ZipFile(target) as z:
            for item in z.namelist():
                if Path(item).is_absolute() or '..' in Path(item).parts or '.data/' in item:raise RuntimeError('wheel_requires_other_installer')
            z.extractall(site_path)
        selected.append({'filename':wheel['filename'],'sha256':wheel['sha256']})
    versions=json.loads(subprocess.check_output([str(py),'-c','import json,importlib.metadata as m;print(json.dumps({n:m.version(n) for n in ["psycopg","psycopg-binary","typing_extensions"]}))'],text=True,env=env))
    for name,settings in payload['configs'].items():private_write(config/name,json.dumps(settings))
    private_write(config/'README.md',payload['instructions'])
    started=time.monotonic()
    code='import sys,json;sys.path.insert(0,sys.argv[1]);from coordination import Store;s=Store(sys.argv[2]);db=s.connect();r=db.execute("SELECT current_user AS role,current_database() AS database,(SELECT count(*) FROM peticao_coord.migrations) AS migrations,(SELECT ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()) AS backend_tls").fetchone();r["tls"]=db.pgconn.ssl_in_use;r["tls_verification"]="verify-full";db.close();print(json.dumps(r))'
    probe=json.loads(subprocess.check_output([str(py),'-c',code,str(release),str(config/'query-config.json')],text=True,env=env,stderr=subprocess.PIPE))
    if probe['role']!='peticao_coord_reader' or probe['migrations']!=2 or probe['tls'] is not True:raise RuntimeError('database_validation_failed')
    current=root/'current';prior=os.readlink(current) if current.is_symlink() else None
    if current.exists() and not current.is_symlink():raise RuntimeError('current_not_managed_symlink')
    temporary=root/('current-'+uuid.uuid4().hex);temporary.symlink_to(release);os.replace(temporary,current)
    wrapper.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    private_write(wrapper,'#!/bin/sh\n# peticao-coordination-profile\nexec '+shlex.quote(str(current/'venv/bin/python'))+' '+shlex.quote(str(current/'coordination.py'))+' "$@"\n');wrapper.chmod(0o700)
    catalog=home/'.config/peticao/shared-credentials/CATALOG.json'
    if catalog.exists():
        x=json.loads(catalog.read_text())
        for name,ident in [('config.json','coordination/runtime-config'),('query-config.json','coordination/query-config')]:
            x['entries']=[e for e in x['entries'] if e['id']!=ident]
            x['entries'].append({'id':ident,'kind':'coordination-config','path':str(config/name),'origin':'databases-validation-profile','preferred':True})
        x['coordination_profile']={'release':payload['release'],'mode':'isolated','owner_credentials_copied':False}
        private_write(catalog,json.dumps(x,indent=2))
    guide=home/'.config/peticao/CREDENTIALS.md'
    marker='<!-- coordination-profile-20261116 -->'
    if guide.exists() and marker not in guide.read_text():private_write(guide,guide.read_text()+'\n'+marker+'\nCoordenação Neon ISOLADA: `'+str(config/'README.md')+'`. CLI `'+str(wrapper)+'`; configs pelo catálogo `coordination/runtime-config` e `coordination/query-config`. Não é a fila oficial nem autoriza dispatch.\n')
    final=shutil.disk_usage(home).free
    if final<minimum:raise RuntimeError('disk_margin_after_install')
    return {'home':str(home),'python':platform.python_version(),'arch':arch,'versions':versions,'release':payload['release'],
            'previous_release':prior,'query':probe,'roundtrip_seconds':round(time.monotonic()-started,3),'wheels':selected,
            'free_before_bytes':free,'free_after_bytes':final,'wrapper':str(wrapper),'mode':'isolated','owner_credentials_copied':False}


if __name__=='__main__':
    try:print(json.dumps(install(json.load(sys.stdin))))
    except Exception as e:print(json.dumps({'error':type(e).__name__,'reason':str(e) if isinstance(e,(RuntimeError,ValueError)) else 'see private local diagnostics'}));sys.exit(2)
