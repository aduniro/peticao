#!/usr/bin/env python3
"""Install only the reviewed missing Civo tools; refuse drift or daemon packages."""
import hashlib
import io
import json
import os
from pathlib import Path
import re
import shutil
import socket
import subprocess
import sys
import tarfile

BASE = Path('/mnt/apps/peticao-final/.runtime/civo-tools-parity-20261114')
DANGER = re.compile(r'\b(systemctl|invoke-rc\.d|deb-systemd-invoke|deb-systemd-helper|start-stop-daemon|initctl|service)\b')

def run(args, *, timeout=180, env=None, check=True):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout, env=env)
    if check and p.returncode:
        raise RuntimeError(f'{args[0]} exit {p.returncode}: {p.stderr[-3000:]} {p.stdout[-3000:]}')
    return p.stdout

def digest(data):
    return hashlib.sha256(data).hexdigest()

def plan(text):
    if re.search(r'^Remv ', text, re.M):
        raise ValueError('removal forbidden')
    rows = re.findall(r'^Inst (\S+)(?: \[([^\]]+)\])? \((\S+)', text, re.M)
    if any(old for _,old,_ in rows):
        raise ValueError('upgrade/downgrade/reinstallation forbidden')
    pins = {name: version for name,_,version in rows}
    if len(rows) != len(pins) or not pins:
        raise ValueError('empty or duplicate installation plan')
    return pins

def installed():
    return dict(line.split('\t',1) for line in run(['/usr/bin/dpkg-query','-W','-f=${binary:Package}\t${Version}\n']).splitlines())

def services():
    names = run(['/usr/bin/systemctl','list-units','--type=service','--state=running','--no-legend','--no-pager']).splitlines()
    result = {}
    for line in names:
        name = line.split()[0]
        if name.startswith(('user@','session-','getty@','serial-getty@')):
            continue
        result[name] = run(['/usr/bin/systemctl','show',name,'-p','InvocationID','-p','MainPID','-p','ActiveEnterTimestampMonotonic'])
    return result

def inspect_deb(path, pins, expected):
    pkg = run(['/usr/bin/dpkg-deb','-f',str(path),'Package']).strip()
    ver = run(['/usr/bin/dpkg-deb','-f',str(path),'Version']).strip()
    if pins.get(pkg) != ver or digest(path.read_bytes()) != expected[pkg]:
        raise ValueError('download identity/digest mismatch')
    control = subprocess.check_output(['/usr/bin/dpkg-deb','--ctrl-tarfile',str(path)])
    scripts = {}
    with tarfile.open(fileobj=io.BytesIO(control)) as tar:
        for m in tar:
            if Path(m.name).name in {'preinst','postinst','prerm','postrm','config'}:
                if not m.isfile():
                    raise ValueError('nonregular maintainer script')
                raw = tar.extractfile(m).read()
                active = '\n'.join(s for s in raw.decode().splitlines() if not s.lstrip().startswith('#'))
                if DANGER.search(active):
                    raise ValueError(f'service operation in {pkg}:{m.name}; review required')
                scripts[m.name] = digest(raw)
    contents = run(['/usr/bin/dpkg-deb','-c',str(path)])
    if re.search(r'\./(?:usr/)?lib/systemd/(?:system|user)/|\./etc/(?:init\.d|init)/',contents):
        raise ValueError('daemon/unit package forbidden')
    return {'package':pkg,'version':ver,'sha256':expected[pkg],'maintainer_script_hashes':scripts}

def main(request):
    os.umask(0o077)
    if os.geteuid() or socket.gethostname() != 'peticao-civo':
        raise PermissionError('Civo root only')
    pins=request['pins']
    if set(pins) != set(request['sha256']) or len(pins)!=122:
        raise ValueError('exact reviewed package closure required')
    if BASE.resolve() != BASE or any(p.is_symlink() for p in BASE.parents):
        raise ValueError('symlink ancestor forbidden')
    if BASE.exists() or BASE.is_symlink():
        raise FileExistsError('previous attempt exists; inspect, never blindly repeat')
    if shutil.disk_usage('/').free < 20*2**30:
        raise ValueError('20GiB free floor required')
    current=installed()
    if any(p in current or p+':amd64' in current for p in pins):
        raise ValueError('reviewed new package already installed; refuse drift')
    specs=[f'{p}={v}' for p,v in sorted(pins.items())]
    apt=['/usr/bin/apt-get','--no-upgrade','--no-remove','--no-install-recommends']
    simulated=run(apt+['--simulate','install',*specs])
    if plan(simulated)!=pins:
        raise ValueError('solver drift before any package changes')
    BASE.mkdir(mode=0o700)
    receipt={'phase':'preflight_pass','execution':request['execution'],'before_packages':current,'before_services':services(),'simulation':simulated}
    def save():
        (BASE/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    save()
    cache=BASE/'archives'; cache.mkdir(); (cache/'partial').mkdir()
    conf=BASE/'apt.conf'
    conf.write_text('#clear DPkg::Pre-Invoke;\n#clear DPkg::Post-Invoke;\n#clear DPkg::Pre-Install-Pkgs;\n')
    env=dict(os.environ,DEBIAN_FRONTEND='noninteractive',NEEDRESTART_MODE='l',TMPDIR=str(BASE),TMP=str(BASE),TEMP=str(BASE))
    args=apt+['-c',str(conf),'-o','Dir::Cache::archives='+str(cache),'-o','APT::Get::AllowUnauthenticated=false','-o','Acquire::AllowInsecureRepositories=false']
    receipt['download_log']=run(args+['--download-only','-y','install',*specs],timeout=900,env=env);save()
    records=[inspect_deb(p,pins,request['sha256']) for p in sorted(cache.glob('*.deb'))]
    if {x['package']:x['version'] for x in records}!=pins or len(records)!=len(pins):
        raise ValueError('download set mismatch')
    receipt.update(phase='downloads_verified',packages=records);save()
    if installed()!=current or plan(run(args+['--simulate','install',*specs]))!=pins:
        raise ValueError('installed set/solver changed during download')
    receipt['phase']='installation_started';save()
    receipt['install_log']=run(args+['--no-download','-y','install',*specs],timeout=900,env=env);save()
    after=installed()
    if any(after.get(p)!=v for p,v in current.items()):
        raise ValueError('pre-existing package changed')
    normalized={p.split(':')[0]:v for p,v in after.items() if p not in current}
    if normalized!=pins:
        raise ValueError('actual installed additions differ from reviewed plan')
    receipt.update(phase='installed',after_services=services())
    receipt['services_unchanged']=receipt['before_services']==receipt['after_services'];save()
    if not receipt['services_unchanged']:
        raise RuntimeError('service state changed; inspect without automatic recovery')
    public=Path('/mnt/apps/peticao-final/.runtime/civo-tools-smoke-20261114')
    if public.resolve() != public:
        raise ValueError('smoke symlink forbidden')
    public.mkdir(mode=0o755);public.chmod(0o755);os.chown(public,1000,1000)
    env.update(HOME=str(public),TMPDIR=str(public),TMP=str(public),TEMP=str(public))
    code = """import json,pathlib,subprocess
w=pathlib.Path.cwd()
def call(a):return subprocess.check_output(a,stderr=subprocess.STDOUT,text=True)
(w/'CMakeLists.txt').write_text('cmake_minimum_required(VERSION 3.16)\\nproject(smoke C)\\nadd_executable(smoke main.c)\\n')
(w/'main.c').write_text('#include <stdio.h>\\nint main(void){puts("fictitious smoke");return 0;}\\n')
r={'cmake':call(['/usr/bin/cmake','-S',str(w),'-B',str(w/'build')])}
r['build']=call(['/usr/bin/cmake','--build',str(w/'build'),'--parallel','2'])
assert call([str(w/'build/smoke')]).strip()=='fictitious smoke'
call(['/usr/bin/ffmpeg','-nostdin','-v','error','-f','lavfi','-i','color=c=blue:s=160x120:d=1','-c:v','mpeg4',str(w/'clip.mp4')])
r['video']=json.loads(call(['/usr/bin/ffprobe','-v','error','-show_entries','stream=width,height','-of','json',str(w/'clip.mp4')]))
assert r['video']['streams'][0]['width']==160
call(['/usr/bin/convert','-size','120x80','xc:blue','-resize','60x40',str(w/'image.png')])
r['image']=call(['/usr/bin/identify','-format','%wx%h',str(w/'image.png')]);assert r['image']=='60x40'
print(json.dumps(r))"""
    runner='import os;os.chdir('+repr(str(public))+');exec('+repr(code)+')'
    receipt['smoke']=json.loads(run(['/usr/sbin/runuser','-u','civo','--','/usr/bin/python3','-c',runner],env=env,timeout=180))
    receipt.update(phase='smokes_pass',versions={p:run([p,'-version' if p.endswith('convert') else '-version' if p.endswith('ffmpeg') else '--version']).splitlines()[0] for p in ['/usr/bin/cmake','/usr/bin/ffmpeg','/usr/bin/convert']})
    save()
    print(json.dumps({'ok':True,'phase':receipt['phase'],'added':len(pins),'services_unchanged':True,'versions':receipt['versions'],'receipt':str(BASE/'receipt.json')}))

if __name__=='__main__':
    try:main(json.load(sys.stdin))
    except Exception as e:
        print(json.dumps({'ok':False,'error':type(e).__name__,'detail':str(e),'automatic_retry':False}));sys.exit(1)
