"""Deploy only the private isolated CLI profile; transport secrets on stdin."""
import concurrent.futures
import hashlib
import json
from pathlib import Path
import shlex
import subprocess
import sys
from neon_admin import PRIVATE,EVIDENCE,save

ROOT=Path(__file__).parent
LEASES=Path('/mnt/apps/peticao-final/.runtime/databases-control-20261116')
LEDGER=Path('/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/coord.py')
HOSTS=[('dell3576-zorin',None,'barre'),('peticao-civo','cluster-civo-root','civo'),
       ('peticao-oracle-dev-01','cluster-oracle-root','builder'),('peticao-build-a1','cluster-akamai-root','builder'),
       ('peticao-azure-dev-01','cluster-azure-root','builder'),('sonda-verifica3','cluster-santiago-root','sonda'),
       ('peticao-sp','cluster-sp-root','adunir'),('sanciona-integral','cluster-waha-root','wa')]


def ledger(args):
    r=subprocess.run(['python3',str(LEDGER)]+args,capture_output=True,text=True)
    x=json.loads(r.stdout)
    if not x.get('ok'):
        save(LEASES/'last-lease-error.json',x,private=True)
        raise RuntimeError('own_lease_unavailable')
    return x['result']


def deploy(host):
    hostname,alias,user=host;results=[];lease=None
    try:
        lease=ledger(['acquire','--actor','admin-recuperacao','--operation','edit','--resource','deploy:infra-node/'+hostname+'/databases-cli','--ttl','1200'])
        save(LEASES/(hostname+'-lease.json'),lease,private=True)
        configs={name:json.loads((PRIVATE/name).read_text()) for name in ['config.json','query-config.json']}
        if {s.get('role') for s in configs.values()}!={'peticao_coord_reader','peticao_coord_writer'}:raise RuntimeError('owner_or_unknown_role_refused')
        names=['coordination.py','requirements.txt','requirements.lock']
        files={n:(ROOT/n).read_text() for n in names}
        release=hashlib.sha256(json.dumps(files,sort_keys=True).encode()).hexdigest()[:20]
        installer=(ROOT/'install_profile.py').read_text()
        for account in [user,'root']:
            ledger(['check','--actor','admin-recuperacao','--lease',lease['lease'],'--token',lease['token'],'--fence',str(lease['fence'])])
            payload={'release':release,'files':files,'dependencies':json.loads((EVIDENCE/'DEPENDENCY-LOCK.json').read_text()),
                     'configs':configs,'waha':hostname=='sanciona-integral',
                     'instructions':'# Coordenação Neon — perfil isolado\n\nCLI: ~/.local/bin/peticao-tasks\nConsulta: peticao-tasks --config ~/.config/peticao/databases/query-config.json external-jobs --limit 20\nLista de validação: peticao-tasks list --limit 20\nModo isolado do app: backlog administrativo somente nos namespaces aprovados Root/Infra; nenhuma reserva desta ferramenta autoriza efeitos reais; ledger Dell e fila Santiago permanecem únicos para recursos/execução. Sem polling/daemon. Owner de migrações não foi copiado. Credenciais apenas neste diretório protegido.\n'}
            if alias:
                command=['python3','-c',installer] if account=='root' else ['sudo','-H','-u',account,'python3','-c',installer]
                args=['ssh','-o','BatchMode=yes','-o','ConnectTimeout=12',alias,shlex.join(command)]
            else:args=['python3','-c',installer] if account==user else ['sudo','-H','python3','-c',installer]
            r=subprocess.run(args,input=json.dumps(payload),capture_output=True,text=True,timeout=240)
            if r.returncode:
                try:reason=json.loads(r.stdout)
                except Exception:reason={'error':'transport_or_installer_failed','rc':r.returncode}
                results.append({'account':account,'status':'FAILED','detail':reason});break
            results.append({'account':account,'status':'PASS','proof':json.loads(r.stdout)})
        return {'host':hostname,'accounts':results,'fence':lease['fence']}
    except Exception as e:return {'host':hostname,'accounts':results,'error':type(e).__name__}
    finally:
        if lease:
            try:
                ledger(['release','--actor','admin-recuperacao','--lease',lease['lease'],'--token',lease['token'],'--fence',str(lease['fence']),'--outcome','completed' if len(results)==2 and all(r['status']=='PASS' for r in results) else 'aborted','--summary','Private coordination CLI profile, no services/app changes'])
            except Exception:pass  # result must still be reviewed before any retry


if __name__=='__main__':
    selected=HOSTS if len(sys.argv)==1 else [h for h in HOSTS if h[0] in sys.argv[1:]]
    output=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
        for result in pool.map(deploy,selected):output.append(result);print(json.dumps(result),flush=True)
    save(EVIDENCE/('HOSTS-'+('-'.join(h[0] for h in selected) if len(selected)<8 else 'ALL')+'.json'),output)
