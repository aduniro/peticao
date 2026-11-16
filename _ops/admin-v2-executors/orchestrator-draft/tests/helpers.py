from pathlib import Path
import copy
import hashlib
import json
import uuid
from protocol import ENV, NODE_SHA256, canonical_sha256, validate_config, validate_job

ROOT=Path(__file__).resolve().parents[1]
class Clock:
    def __init__(self):self.now=1000.0
    def __call__(self):return self.now
    def advance(self,n):self.now+=n

def fixture_config(root,enabled=True):
    c=json.loads((ROOT/'config.json').read_text())
    c['execution_enabled']=enabled;c['hosts']['santiago']['enabled']=enabled
    c['hosts']['santiago']['machine_id_sha256']='a'*64
    c['hosts']['santiago']['repository_root']=str(root/'repos')
    c['hosts']['local']['repository_root']=str(root/'local-repos')
    c['state_path']=str(root/'state/queue.sqlite');c['artifact_root']=str(root/'artifacts')
    return validate_config(c)

def job_data(c):
    return {'schema_version':1,'job_id':str(uuid.uuid4()),'intent_id':str(uuid.uuid4()),'kind':'qualification_delivery','target_worker':'santiago',
    'source':{'commit':'1'*40,'ref':'worker/admin-v2-qualification','repository_path':str(Path(c['hosts']['santiago']['repository_root'])/'qualification'),'bundle_sha256':'2'*64,'source_manifest_sha256':'3'*64,'wrapper_sha256':c['wrappers']['qualification_delivery']['sha256']},
    'runtime':{'node_version':'20.19.2','node_sha256':NODE_SHA256,'next_version':'14.2.35','package_lock_sha256':'4'*64,'assets_manifest_sha256':'5'*64,'assets_count':202},
    'integration':{'ref':'integration/admin-v2-pilot','expected_base':'6'*40},'env':copy.deepcopy(ENV),'resources':{'cpu_cores':2,'memory_mib':4096,'timeout_seconds':600},'safety':{'production':False,'external_messages':False,'automatic_retry':False}}

def ready(c,clock):
    return {'schema_version':1,'handshake_id':str(uuid.uuid4()),'worker_id':'santiago','role':'integrator','repository_root':c['hosts']['santiago']['repository_root'],'machine_id_sha256':c['hosts']['santiago']['machine_id_sha256'],'issued_at':clock(),'expires_at':clock()+1200,'config_sha256':canonical_sha256(c),'capability_sha256':'7'*64,'node_version':'20.19.2','node_sha256':NODE_SHA256,'next_version':'14.2.35'}

def result(c,job,row,exit_code=0):
    checks={k:True for k in ['source_stable','runtime_assets_stable','commit_stable','build_source_map_equal','data_invariants','network_guard','ports_closed','coverage_complete']}
    if exit_code:checks['coverage_complete']=False
    name=f'{job["job_id"]}/generation-{row["generation"]}/execution.json'
    value={'commit':job['source']['commit'],'buildCommit':job['source']['commit'],'exit':exit_code,'runtimeAssets':202,'sourceStable':True,'runtimeAssetsStable':True,'commitStable':True,'completeBuildSourceMapEqual':True,'portsClosed':{'54390':True,'3077':True,'3078':True}}
    wire=json.dumps(value,sort_keys=True).encode();path=Path(c['artifact_root'])/name;path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(wire)
    return {'schema_version':1,'job_id':job['job_id'],'claim_id':row['claim_id'],'generation':row['generation'],'worker_id':'santiago','commit':job['source']['commit'],'build_commit':job['source']['commit'],'source_manifest_sha256':job['source']['source_manifest_sha256'],'wrapper_sha256':job['source']['wrapper_sha256'],'assets_manifest_sha256':job['runtime']['assets_manifest_sha256'],'package_lock_sha256':job['runtime']['package_lock_sha256'],'node_sha256':job['runtime']['node_sha256'],'exit_code':exit_code,'checks':checks,'coverage':c['required_checks'][job['kind']][:],'artifacts':[{'path':name,'sha256':hashlib.sha256(wire).hexdigest(),'bytes':len(wire)}],'execution_artifact':name}
