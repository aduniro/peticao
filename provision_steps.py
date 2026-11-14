"""Exact reviewed Civo creation requests; no generic cloud mutation interface.

The operator runs these steps on Akamai, so intents/responses survive the Dell.
Every POST has a fresh normal-deployment permit and a durable, fixed journal key.
No Tailscale auth secret is sent in provider userdata. OS setup is a separate
SSH step. Importing this module never creates infrastructure.
"""
import json
import hashlib
from pathlib import Path
import re
import subprocess
from datetime import datetime,timezone,timedelta
from durable_api import Journal, LifecycleLock
from runtime_main import private_file

REGION='NYC1'
NETWORK='79ae54a4-f35b-462d-ab6c-0f9811a19cec'
IMAGE='9fb7b840-6cde-448a-b570-6418430c6ac8'
HOSTNAME='peticao-civo-worker-nyc1.internal'


def identifier(value):
    if not isinstance(value,str) or not re.fullmatch('[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}',value):
        raise ValueError('Provider resource UUID missing')
    return value


def owned_id(directory,key,path):
    entry=json.loads((Path(directory)/(key+'.json')).read_text())
    digest=hashlib.sha256(json.dumps(entry.get('request'),sort_keys=True).encode()).hexdigest()
    if (entry.get('state')!='completed' or entry.get('request',{}).get('method')!='POST'
            or entry['request'].get('path')!=path or entry.get('request_sha256')!=digest):
        raise ValueError('Prerequisite has no owned creation response')
    return identifier(entry['response'].get('id'))


RULES={
    'bootstrap-ssh':dict(protocol='tcp',start_port=22,end_port=22,cidr='172.235.145.216/32',direction='ingress'),
    'tailnet-transport':dict(protocol='udp',start_port=41641,end_port=41641,cidr='0.0.0.0/0',direction='ingress'),
    'outbound-tcp':dict(protocol='tcp',start_port=1,end_port=65535,cidr='0.0.0.0/0',direction='egress'),
    'outbound-udp':dict(protocol='udp',start_port=1,end_port=65535,cidr='0.0.0.0/0',direction='egress'),
}


def request_for(step,directory,public_key=None):
    if step=='ssh-key':
        if not isinstance(public_key,str) or not public_key.startswith('ssh-ed25519 ') or '\n' in public_key:
            raise ValueError('Existing public Ed25519 key required; private keys are forbidden')
        return '/v2/sshkeys',dict(name='peticao-civo-akamai',public_key=public_key)
    if step=='firewall':
        return '/v2/firewalls',dict(name='peticao-civo-worker-nyc1',network_id=NETWORK,region=REGION)
    if step.startswith('rule-') and step[5:] in RULES:
        firewall=owned_id(directory,'create-firewall','/v2/firewalls')
        return '/v2/firewalls/'+firewall+'/rules',dict(RULES[step[5:]],region=REGION,label=step)
    if step=='instance':
        firewall=owned_id(directory,'create-firewall','/v2/firewalls')
        key=owned_id(directory,'create-ssh-key','/v2/sshkeys')
        for name in RULES:owned_id(directory,'create-rule-'+name,'/v2/firewalls/'+firewall+'/rules')
        return '/v2/instances',dict(hostname=HOSTNAME,size='g4c.medium',network_id=NETWORK,
                template_id=IMAGE,region=REGION,firewall_id=firewall,ssh_key_id=key,
                initial_user='builder',public_ip='create',count=1,tags='peticao cpu-only infra-owned')
    if step=='volume':
        owned_id(directory,'create-instance','/v2/instances')
        return '/v2/volumes',dict(name='peticao-civo-worker-data',size_gb=200,network_id=NETWORK,region=REGION)
    raise ValueError('Step is outside approved CPU-only plan')


def require_ready(directory,policy_sha):
    if not isinstance(policy_sha,str) or not re.fullmatch('[0-9a-f]{64}',policy_sha):
        raise ValueError('Reviewed active policy digest required')
    ready=json.loads(private_file(Path(directory)/'readiness.json').read_text())
    now=datetime.now(timezone.utc);seen=datetime.fromisoformat(ready['at'])
    if (ready.get('state')!='armed_without_allocation' or ready.get('policy_sha256')!=policy_sha
            or ready.get('boot_id')!=Path('/proc/sys/kernel/random/boot_id').read_text().strip()
            or seen>now or now-seen>timedelta(seconds=420)):
        raise ValueError('Fresh live controller readiness required')
    for operation in ['is-active','is-enabled']:
        result=subprocess.run(['systemctl',operation,'peticao-civo-finance.timer'],
                              capture_output=True,text=True,timeout=10)
        if result.returncode:raise ValueError('Financial timer must be active and enabled before billing')


def perform_step(step,directory,api,gate,public_key=None,policy_sha=None):
    # The deployment caller also verifies timer readiness, fresh live quota,
    # price/credit evidence and cloud policy before invoking a billable step.
    with LifecycleLock(Path(directory)/'lifecycle.lock'):
        path,payload=request_for(step,Path(directory)/'journal',public_key)
        if step in {'instance','volume'}:require_ready(directory,policy_sha)
        request={'method':'POST','path':path,'payload':payload}
        def validate(response):identifier(response.get('id'))
        journal=Journal(Path(directory)/'journal',lambda:gate(request))
        response=journal.perform('create-'+step,request,
                lambda:api.request('POST',path,payload=payload),validate)
        return {'id':response['id'],'step':step,'creation_response_bound':True}
