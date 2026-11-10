#!/usr/bin/python3
"""One-shot local Vigia observer; timer installation is external."""
from __future__ import annotations
import argparse
import datetime as dt
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import tempfile

BASE=Path(__file__).resolve().parent.parent
MONITOR=Path('/mnt/apps/peticao-final/peticao/tools/monitor')
CHECKPOINT=BASE/'state'/'vigia-bridge.json'
JOB_ID=re.compile(r'[a-f0-9]{32}\Z')
STATES={'queued':'queued','starting':'waiting','running':'running','completed':'completed','failed':'failed','interrupted':'interrupted','canceled':'interrupted'}
STAGES={'queued':'Na fila; ainda não executado','starting':'Inicialização solicitada; aguardando confirmação do worker','running':'Worker em execução observada','completed':'Execução concluída','failed':'Execução falhou','interrupted':'Execução interrompida; revisão necessária','canceled':'Execução cancelada'}

def now():return dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
def encode(value):return json.dumps(value,sort_keys=True,ensure_ascii=False)
def save(path,value):
    path.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    fd,tmp=tempfile.mkstemp(prefix='.vigia-',dir=path.parent)
    try:
        with os.fdopen(fd,'w') as out:
            out.write(encode(value)+'\n');out.flush();os.fsync(out.fileno())
        os.chmod(tmp,0o600);os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def client():
    spec=importlib.util.spec_from_file_location('admin_cluster_client',BASE/'infra'/'cluster.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module

def unwrap(value):
    if not isinstance(value,dict):raise ValueError('invalid_rpc_object')
    if value.get('ok') is False or value.get('error'):raise RuntimeError('coordinator_reported_error')
    return value['result'] if value.get('ok') is True else value

def task_id(job):
    if not isinstance(job,str) or not JOB_ID.fullmatch(job):raise ValueError('invalid_job_id')
    return 'cluster-job-'+job

def observe(store,node,payload,checkpoint):
    payload=unwrap(payload)
    jobs=payload.get('jobs');events=payload.get('events')
    if not isinstance(jobs,list) or not isinstance(events,list):raise ValueError('invalid_jobs_response')
    authority=payload.get('authority',{})
    generation=authority.get('generation',0)
    old=checkpoint.get(node,{})
    offset=int(old.get('after_seq',0))
    tracked=dict(old.get('jobs',{}))
    seen_at=now()
    for job in jobs:
        jid=job.get('id');tid=task_id(jid)
        state=job.get('state')
        if state not in STATES:raise ValueError('unknown_job_state')
        kind=job.get('kind','não informado')
        commit=job.get('source_commit') or 'fixture; sem commit de aplicação'
        detail={'node':node,'observed_at':seen_at,'authority':authority,'source_commit':job.get('source_commit'),'coordinator_state':state,'job_generation':job.get('generation'),'exit_code':job.get('exit_code'),'error':job.get('error'),'started_at':job.get('started_at'),'finished_at':job.get('finished_at'),'paths':job.get('paths',{}),'result':job.get('result')}
        store.task(tid,title='Cluster · '+str(kind)+' · '+jid[:10],state=STATES[state],stage=STAGES[state]+' | '+node+' | '+str(commit),environment='tailnet/'+node,cwd=str(BASE),scope='Observação isolada de um job; não representa o progresso total do admin-v2.',detail=encode(detail),eta='Sem estimativa comprovada')
        tracked[jid]={'state':state,'observed_at':seen_at,'kind':kind,'commit':job.get('source_commit')}
    # Stable IDs keep event recording idempotent if the process dies before saving offsets.
    for event in sorted(events,key=lambda e:int(e['seq'])):
        seq=int(event['seq'])
        if seq<=offset:continue
        jid=event.get('job_id')
        tid=task_id(jid) if jid else 'cluster-observer-'+node
        if jid and jid not in tracked:
            store.task(tid,title='Cluster · job '+jid[:10],state='waiting',stage='Evento recebido; estado atual fora da janela de consulta',environment='tailnet/'+node,cwd=str(BASE),scope='Observação isolada de um job.',detail=encode({'node':node,'remote_event_seq':seq,'meaning':'Evento histórico não comprova estado atual.'}),eta='Sem estimativa comprovada')
            tracked[jid]={'state':'unknown','observed_at':seen_at}
        data={'node':node,'generation':generation,'remote_at':event.get('at'),'remote_seq':seq,'data':event.get('data',{})}
        store.event('cluster_'+str(event.get('kind','event')),'Cluster '+node+': '+str(event.get('kind','evento')),tid,data,'cluster:'+node+':'+str(generation)+':'+str(seq))
        offset=seq
    store.task('cluster-observer-'+node,title='Cluster · observação '+node,state='waiting',stage='Fila consultada; observador aguarda próxima coleta',environment='local',cwd=str(BASE),scope='Somente observação; não inicia trabalhos.',detail=encode({'observed_at':seen_at,'jobs_returned':len(jobs),'authority':authority,'after_seq':offset}),eta='Nova coleta pelo timer externo, aproximadamente 30 segundos')
    store.snapshot('cluster-observer-'+node,{'at':seen_at,'jobs':len(jobs),'authority':authority,'after_seq':offset},'online')
    checkpoint[node]={'after_seq':offset,'jobs':tracked,'last_success_at':seen_at,'last_error':None}
    return {'node':node,'jobs_observed':len(jobs),'after_seq':offset,'at':seen_at}

def failed(store,node,error,checkpoint):
    old=checkpoint.get(node,{})
    detail={'at':now(),'error_type':type(error).__name__,'last_success_at':old.get('last_success_at'),'meaning':'Não foi possível consultar o coordenador. Estados remotos atuais não estão confirmados.'}
    # Preserve last known state in detail; never claim that a failed poll proves a job stopped.
    for jid,job in old.get('jobs',{}).items():
        if job.get('state') not in {'queued','starting','running'}:continue
        store.task(task_id(jid),state='waiting',stage='Observação indisponível; estado remoto atual não confirmado',detail=encode({**detail,'last_observed_job':job,'node':node}))
    tid='cluster-observer-'+node
    store.task(tid,title='Cluster · observação '+node,state='failed',stage='Falha na consulta; nenhuma execução presumida',environment='local',cwd=str(BASE),scope='Somente observação.',detail=encode(detail),eta='Nova tentativa pelo timer externo')
    fingerprint=hashlib.sha256(encode(detail).encode()).hexdigest()[:20]
    store.event('cluster_observation_error','Observação do cluster indisponível',tid,detail,'cluster-observation-error:'+node+':'+fingerprint)
    store.snapshot(tid,detail,'offline')
    checkpoint[node]={**old,'last_error':detail}
    return detail

def main(argv=None):
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--node',choices=['santiago','sp'],default='santiago')
    parser.add_argument('--checkpoint',type=Path,default=CHECKPOINT)
    parser.add_argument('--vigia-db',type=Path,help='Optional isolated local monitor database for verification')
    parser.add_argument('--input-json',type=Path,help='Offline jobs RPC capture; never makes an SSH connection')
    args=parser.parse_args(argv)
    if not args.checkpoint.is_absolute() or args.vigia_db and not args.vigia_db.is_absolute():raise ValueError('absolute_local_paths_required')
    args.checkpoint.parent.mkdir(parents=True,exist_ok=True,mode=0o700)
    sys.path.insert(0,str(MONITOR))
    from vigia_monitor.store import Store
    os.umask(0o077)
    with args.checkpoint.with_suffix('.lock').open('a') as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(encode({'state':'already_collecting'}));return 0
        checkpoint=json.loads(args.checkpoint.read_text()) if args.checkpoint.exists() else {}
        store=Store(args.vigia_db)
        try:
            if args.input_json:
                payload=json.loads(args.input_json.read_text())
            else:
                payload=client().rpc(args.node,{'action':'jobs','limit':200,'after_seq':checkpoint.get(args.node,{}).get('after_seq',0)})
            result=observe(store,args.node,payload,checkpoint)
            save(args.checkpoint,checkpoint);print(encode({'ok':True,'result':result}));return 0
        except Exception as error:
            detail=failed(store,args.node,error,checkpoint)
            save(args.checkpoint,checkpoint);print(encode({'ok':False,'result':detail}));return 1

if __name__=='__main__':
    try:sys.exit(main())
    except Exception as error:
        print(encode({'ok':False,'error_type':type(error).__name__,'state':'bridge_failed_without_confirmed_remote_state'}));sys.exit(1)
