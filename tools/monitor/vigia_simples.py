#!/usr/bin/env python3
"""Single-screen, read-only observer. Agent updates are distinct from OS evidence."""
from __future__ import annotations
import argparse, datetime as dt, json, os, re, select, shutil, subprocess, sys, tempfile, threading, time
from pathlib import Path
from zoneinfo import ZoneInfo
ROOT = Path('/mnt/dev/peticao')
STATE = Path(os.environ.get('VIGIA_SIMPLES_STATE', str(Path.home()/'.local/state/peticao-monitor/simple')))
ZONE = ZoneInfo('America/Porto_Velho')
PROCESS_OFFSET = 0
STATES = {'running':'em execução','waiting':'aguardando','completed':'concluída','failed':'falhou','interrupted':'interrompida','queued':'na fila'}
FIELDS = {'id','title','stage','environment','scope','state','updated_at','created_at','done','total','eta','detail'}

def now(): return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
def clean(value, limit=240):
    value = re.sub(r'\x1b\][^\x07]*(?:\x07|\x1b\\)', '', str(value))
    value = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', value)
    value = ''.join(c for c in value if c >= ' ' or c in '\n\t')
    value = re.sub(r'(?i)(password|secret|api[_-]?key|authorization|token)\s*[:=]\s*[^\s,;]+', r'\1=[restrito]', value)
    value = re.sub(r'(?<!\d)\d{3}\.?\d{3}\.?\d{3}-?\d{2}(?!\d)', '[CPF omitido]', value)
    return value[:limit]
def stamp(value):
    if not isinstance(value,str):return '—'
    try:return dt.datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(ZONE).strftime('%H:%M:%S')
    except (ValueError,TypeError):return '—'
def age(value):
    if not isinstance(value,str):return None
    try:return max(0,int((dt.datetime.now(dt.timezone.utc)-dt.datetime.fromisoformat(value.replace('Z','+00:00'))).total_seconds()))
    except (ValueError,TypeError):return None

def atomic(path, value):
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.update-')
    try:
        os.fchmod(fd,0o600)
        with os.fdopen(fd,'w') as f:json.dump(value,f,ensure_ascii=False);f.flush();os.fsync(f.fileno())
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)

def register(args):
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,70}',args.register):raise ValueError('identificador inválido')
    path=STATE/'activities'/(args.register+'.json')
    try:old=json.loads(path.read_text())
    except (OSError,ValueError):old={}
    row={'id':args.register,'title':clean(args.title or old.get('title',args.register)), 'state':args.state or old.get('state','running'), 'created_at':old.get('created_at',now()),'updated_at':now()}
    for key in ['stage','environment','scope','eta','detail']:
        val=getattr(args,key,None)
        if val is not None:row[key]=clean(val,500)
        elif key in old:row[key]=old[key]
    if args.done is not None or args.total is not None:
        if args.done is None or args.total is None or args.total<=0 or not 0<=args.done<=args.total:raise ValueError('informe --done e --total válidos juntos')
        row.update(done=args.done,total=args.total)
    elif 'done' in old:row.update(done=old['done'],total=old['total'])
    atomic(path,row);return row

def activities():
    rows=[]
    for path in (STATE/'activities').glob('*.json'):
        try:
            raw=json.loads(path.read_text())
            if not isinstance(raw,dict):continue
            row={k:v for k,v in raw.items() if k in FIELDS}
            if row.get('state') in STATES:rows.append(row)
        except (OSError,ValueError,TypeError):pass
    return sorted(rows,key=lambda r:(r.get('state')=='completed',r.get('created_at','')))

def processes():
    rows=[]
    for entry in Path('/proc').iterdir():
        if not entry.name.isdigit() or int(entry.name)==os.getpid():continue
        try:
            comm=(entry/'comm').read_text().strip()
            if comm == 'node_repl' or not comm.startswith(('node','next-server','python','postgres','npm')):continue
            cwd=str((entry/'cwd').resolve())
            if not (cwd==str(ROOT) or cwd.startswith(str(ROOT)+'/') or cwd.startswith('/mnt/dev/cpfs')):continue
            args=[a.decode(errors='replace') for a in (entry/'cmdline').read_bytes().split(b'\0') if a]
            if args and args[0].startswith('postgres:'):continue
            label=comm;port=''
            scripts=[a for a in args[1:] if a.endswith(('.py','.mjs','.js')) and a.startswith(('/mnt/dev/peticao/','tools/','scripts/','./tools/')) and not any(c in a for c in ['\n',' '])]
            if scripts:label=Path(scripts[0]).name
            if label.startswith('run-') and label.endswith('-qa.py'):label='supervisor de prévia/QA'
            for i,a in enumerate(args[:-1]):
                if a in ['-p','--port'] and args[i+1].isdigit():port=args[i+1]
            rows.append({'pid':int(entry.name),'name':clean(label,60),'port':port,'cwd':cwd})
        except (OSError,ValueError,PermissionError):pass
    return sorted(rows,key=lambda row:-row['pid'])

def local_services():
    names=['peticao-vigia.service','peticao-vigia-respostas.service','peticao-cpf-review-access.service','peticao-cpf-review-sync.service']
    try:
        r=subprocess.run(['systemctl','--user','is-active',*names],capture_output=True,text=True,timeout=2)
        return [{'name':n,'state':s} for n,s in zip(names,r.stdout.splitlines())]
    except (OSError,subprocess.TimeoutExpired):return [{'name':'serviços locais','state':'indisponível'}]

REMOTE_SCRIPT="""from pathlib import Path
import subprocess,json,datetime
r=Path('/opt/peticao/app')
units=['peticao.service','caddy.service','postgresql@17-main.service','reacher.service']
p=subprocess.run(['systemctl','is-active',*units],capture_output=True,text=True)
print(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'services':dict(zip(units,p.stdout.splitlines())),'diagnostics_source':(r/'src/lib/signup-diagnostics.ts').is_file(),'diagnostics_build':(r/'.next/server/app/api/sign-diagnostic/route.js').is_file()}))
"""
class Remote:
    def __init__(self, enabled=True):self.value={'state':'consultando' if enabled else 'desativado'};self.enabled=enabled;self.stop=threading.Event()
    def start(self):
        if self.enabled:threading.Thread(target=self.loop,daemon=True).start()
    def loop(self):
        while not self.stop.is_set():
            try:
                r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=4','-o','ServerAliveInterval=3','-o','ServerAliveCountMax=1','peticao-root','python3','-'],input=REMOTE_SCRIPT,capture_output=True,text=True,timeout=8)
                if r.returncode:raise OSError()
                data=json.loads(r.stdout)
                if not isinstance(data.get('services'),dict):raise ValueError()
                self.value={**data,'state':'online','received_at':now()}
            except (OSError,ValueError,subprocess.TimeoutExpired):self.value={**self.value,'state':'sem conexão','checked_at':now()}
            self.stop.wait(10)

def snapshot(remote=None):
    return {'at':now(),'activities':activities(),'processes':processes(),'services':local_services(),'vps':remote.value if remote else {'state':'não consultada'}}

def render(data, width, height, paused=False):
    from rich.console import Group
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    if height < 36:return render_compact(data,width,height,paused)
    groups=[Text(f"VIGIA SIMPLES · {stamp(data['at'])} (Porto Velho) · {'PAUSADO' if paused else 'atualiza a cada 2 s'}",style='bold green')]
    table=Table(expand=True);table.add_column('Atividade',ratio=2);table.add_column('Estado / etapa',ratio=3);table.add_column('Atualização / progresso',ratio=2)
    for r in data['activities'][:6]:
        elapsed=age(r.get('updated_at',''));stale=' · sem atualização recente' if elapsed is not None and elapsed>180 and r['state']=='running' else ''
        pct=f"{100*r['done']/r['total']:.0f}% ({r['done']}/{r['total']})" if r.get('total') else 'progresso não medido'
        table.add_row(Text(f"{r['title']}\n{r.get('environment','—')} · {r.get('scope','—')}"),Text(f"{STATES[r['state']]}{stale}\n{r.get('stage','—')}\n{r.get('detail','')}"),Text(f"{stamp(r.get('updated_at'))} · {pct}\nETA: {r.get('eta','sem estimativa')}"))
    if not data['activities']:table.add_row('Nenhuma atividade registrada','Processos abaixo são observados diretamente.','—')
    groups.append(Panel(table,title='Andamento registrado pelos agentes',border_style='green'))
    local=' · '.join(f"{s['name'].replace('peticao-','').replace('.service','')}: {s['state']}" for s in data['services'])
    remote=data['vps'];vps=f"VPS: {remote.get('state')}"
    if remote.get('services'):
        vps+=' · '+' · '.join(f"{k.replace('.service','')}: {v}" for k,v in remote['services'].items())
        vps+=f"\nNovos logs: {'módulo e build presentes' if remote.get('diagnostics_source') and remote.get('diagnostics_build') else 'não publicados nesta fonte'} · coleta: {stamp(remote.get('received_at'))}"
    groups.append(Panel(Text(local+'\n'+vps),title='Serviços — observação direta',border_style='cyan'))
    proc=Table(expand=True);proc.add_column('PID',width=9);proc.add_column('Processo',ratio=2);proc.add_column('Porta',width=6);proc.add_column('Diretório',ratio=5)
    limit=max(3,min(16,height-23))
    for r in data['processes'][PROCESS_OFFSET:PROCESS_OFFSET+limit]:proc.add_row(str(r['pid']),Text(r['name']),r['port'],Text(r['cwd']))
    groups.append(Panel(proc,title=f"Processos do projeto: {len(data['processes'])} · exibindo {min(limit,len(data['processes']))}",border_style='blue'))
    groups.append(Text('q: sair  |  j/k: processos  |  espaço: pausar  |  r: atualizar  ·  Fechar esta tela não encerra os trabalhos.',style='dim'))
    return Group(*groups)

def render_compact(data, width, height, paused=False):
    from rich.console import Group
    from rich.panel import Panel
    from rich.table import Table
    from rich.text import Text
    lines=[]
    for row in data['activities'][:3]:
        stale=' [sem atualização recente]' if (age(row.get('updated_at','')) or 0)>180 and row['state']=='running' else ''
        line=f"{row['title']} | {STATES[row['state']]} | {row.get('stage','—')} | {row.get('environment','—')}{stale}"
        lines.append(Text(line,no_wrap=True,overflow='ellipsis'))
    local=' · '.join(f"{s['name'].replace('peticao-','').replace('.service','')}: {s['state']}" for s in data['services'])
    v=data['vps'];remote=f"VPS: {v.get('state')}"
    if v.get('services'):remote+=' · '+', '.join(k.replace('.service','')+':'+str(value) for k,value in v['services'].items())
    proc=Table(expand=True,padding=(0,1));proc.add_column('PID',width=8);proc.add_column('Processo',ratio=2,no_wrap=True,overflow='ellipsis');proc.add_column('Diretório / porta',ratio=4,no_wrap=True,overflow='ellipsis')
    limit=max(1,min(12,height-18))
    for row in data['processes'][PROCESS_OFFSET:PROCESS_OFFSET+limit]:proc.add_row(str(row['pid']),Text(row['name']),Text(row['cwd']+((' :'+row['port']) if row['port'] else '')))
    return Group(Text(f"VIGIA SIMPLES · {stamp(data['at'])} · {'PAUSADO' if paused else 'LOCAL 2s / VPS 10s'}",style='bold green'),Panel(Group(*lines) if lines else Text('Nenhuma atividade registrada'),title='Atividades registradas pelos agentes',border_style='green'),Panel(Group(Text(local,no_wrap=True,overflow='ellipsis'),Text(remote,no_wrap=True,overflow='ellipsis'),Text('Novos logs: '+('módulo/build presentes' if v.get('diagnostics_source') and v.get('diagnostics_build') else 'não publicados nesta fonte')+' · coleta VPS '+stamp(v.get('received_at')),no_wrap=True,overflow='ellipsis')),title='Serviços observados',border_style='cyan'),Panel(proc,title=f"Processos: {len(data['processes'])} · mostrando {min(limit,len(data['processes']))}",border_style='blue'),Text('q sair | j/k processos | espaço pausa tela | r atualiza | não encerra tarefas',style='dim',no_wrap=True,overflow='ellipsis'))

def main(argv=None):
    global PROCESS_OFFSET
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--json',action='store_true');p.add_argument('--uma-vez',action='store_true');p.add_argument('--sem-vps',action='store_true')
    p.add_argument('--register');p.add_argument('--title');p.add_argument('--state',choices=STATES);p.add_argument('--stage');p.add_argument('--environment');p.add_argument('--scope');p.add_argument('--eta');p.add_argument('--detail');p.add_argument('--done',type=int);p.add_argument('--total',type=int)
    args=p.parse_args(argv)
    if args.register:print(json.dumps(register(args),ensure_ascii=False));return
    remote=Remote(not args.sem_vps);remote.start()
    if args.json or args.uma_vez or not sys.stdout.isatty():
        if not args.sem_vps:
            for _ in range(50):
                if remote.value.get('state')!='consultando':break
                time.sleep(.1)
        data=snapshot(remote);remote.stop.set()
        if args.json:print(json.dumps(data,ensure_ascii=False));return
        from rich.console import Console
        c=Console();c.print(render(data,c.width,c.height));return
    import termios,tty
    from rich.console import Console
    from rich.live import Live
    console=Console();old=termios.tcgetattr(sys.stdin.fileno());paused=False;data=snapshot(remote)
    try:
        tty.setcbreak(sys.stdin.fileno())
        with Live(render(data,console.width,console.height),console=console,screen=True,auto_refresh=False,redirect_stdout=False) as live:
            last=0
            while True:
                if not paused and time.monotonic()-last>=2:data=snapshot(remote);last=time.monotonic()
                live.update(render(data,console.width,console.height,paused),refresh=True)
                ready,_,_=select.select([sys.stdin],[],[],.5)
                if ready:
                    key=os.read(sys.stdin.fileno(),1).decode(errors='ignore')
                    if key in ['q','Q','\x03','']:break
                    if key=='j':PROCESS_OFFSET=min(max(0,len(data['processes'])-1),PROCESS_OFFSET+1)
                    if key=='k':PROCESS_OFFSET=max(0,PROCESS_OFFSET-1)
                    if key==' ':paused=not paused
                    if key in ['r','R']:data=snapshot(remote)
    except KeyboardInterrupt:pass
    finally:remote.stop.set();termios.tcsetattr(sys.stdin.fileno(),termios.TCSADRAIN,old)
if __name__=='__main__':main()
