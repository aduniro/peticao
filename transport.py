"""Pinned SSH transport. Secrets travel on stdin; a timeout never retries."""
import json
import os
from pathlib import Path
import selectors
import subprocess
import time

import artifacts
import remote_contract as contract

HOSTS={'civo':('peticao-civo.tail1a6d71.ts.net',22),'akamai':('peticao-build-a1.tail1a6d71.ts.net',2224),
       'azure':('peticao-azure-dev-01.tail1a6d71.ts.net',2224)}
REMOTE_COMMAND='/usr/bin/python3 -I -B /opt/peticao-dev-worker-broker/broker_proxy.py'
MAX_REQUEST=65536
MAX_REPLY=((artifacts.MAX_BYTES+2)//3)*4+4*1024*1024


class SSHTransport:
    def __init__(self,nodes,timeout=180):self.nodes={k:dict(v) for k,v in nodes.items()};self.timeout=timeout

    def argv(self,node):
        value=self.nodes.get(node)
        if node not in HOSTS or not value or value.get('qualified') is not True:raise PermissionError('worker_not_qualified_or_available')
        host,port=HOSTS[node]
        if (value.get('host'),value.get('port'))!=(host,port):raise PermissionError('fixed_tailnet_endpoint_required')
        key=contract.private_file(value['identity_file'])
        known=contract.root_control_file(value['known_hosts_file'])
        if artifacts.sha(known.read_bytes())!=value['known_hosts_sha256']:raise PermissionError('pinned_host_keys_changed')
        alias=value.get('host_key_alias')
        if alias not in {host,'['+host+']:'+str(port)}:raise ValueError('fixed_host_key_alias_required')
        return ['/usr/bin/ssh','-F','/dev/null','-T','-p',str(port),'-o','BatchMode=yes','-o','IdentitiesOnly=yes',
                '-o','StrictHostKeyChecking=yes','-o','UpdateHostKeys=no','-o','PasswordAuthentication=no',
                '-o','KbdInteractiveAuthentication=no','-o','ControlMaster=no','-o','ControlPath=none','-o','ConnectTimeout=5',
                '-o','ServerAliveInterval=10','-o','ServerAliveCountMax=2','-o','HostKeyAlias='+alias,
                '-o','UserKnownHostsFile='+str(known),'-i',str(key),'root@'+host,REMOTE_COMMAND]

    def call(self,node,request):
        raw=contract.canonical(request).encode()
        if len(raw)>MAX_REQUEST:raise ValueError('bounded_rpc_request_required')
        return exchange(self.argv(node),raw,self.timeout)


def exchange(argv,raw,timeout):
    if not isinstance(raw,bytes) or len(raw)>MAX_REQUEST:raise ValueError('bounded_rpc_request_required')
    process=subprocess.Popen(argv,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,bufsize=0,
                             env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8','HOME':'/root'})
    selector=selectors.DefaultSelector();chunks=[];size=0;offset=0;deadline=time.monotonic()+timeout
    try:
        os.set_blocking(process.stdin.fileno(),False);os.set_blocking(process.stdout.fileno(),False)
        selector.register(process.stdin,selectors.EVENT_WRITE);selector.register(process.stdout,selectors.EVENT_READ)
        while selector.get_map():
            remaining=deadline-time.monotonic()
            if remaining<=0:raise TimeoutError('transport_result_uncertain_observe_same_job')
            for key,_ in selector.select(min(1,remaining)):
                if key.fileobj is process.stdin:
                    try:offset+=os.write(process.stdin.fileno(),raw[offset:])
                    except BrokenPipeError:offset=len(raw)
                    if offset==len(raw):selector.unregister(process.stdin);process.stdin.close()
                else:
                    chunk=os.read(process.stdout.fileno(),1024*1024)
                    if not chunk:selector.unregister(process.stdout);process.stdout.close();continue
                    size+=len(chunk)
                    if size>MAX_REPLY:raise ValueError('bounded_rpc_reply_required')
                    chunks.append(chunk)
        code=process.wait(timeout=max(.1,deadline-time.monotonic()))
        if code!=0:raise RuntimeError('worker_rpc_failed_result_may_be_uncertain')
        reply=json.loads(b''.join(chunks))
        if not isinstance(reply,dict) or set(reply)!={'ok','result'} or reply['ok'] is not True:raise RuntimeError('worker_rpc_rejected')
        return reply['result']
    finally:
        selector.close()
        # Only this local SSH process is terminated; never the remote unit.
        if process.poll() is None:
            try:
                process.terminate()
                try:process.wait(timeout=1)
                except subprocess.TimeoutExpired:process.kill();process.wait(timeout=1)
            except (OSError,subprocess.TimeoutExpired):pass
        for stream in (process.stdin,process.stdout):
            if stream and not stream.closed:stream.close()

class PrivilegedTransport:
    """Queue UID calls one reviewed helper; it never reads root SSH material."""
    def __init__(self,timeout=180):self.timeout=timeout

    def call(self,node,request):
        if node not in HOSTS:raise ValueError('fixed_worker_node_required')
        raw=contract.canonical(request).encode()
        return exchange(['/usr/bin/sudo','-n','/usr/local/libexec/peticao-dev-worker-client',node],raw,self.timeout)


class BrokerTransport(SSHTransport):
    """Persistent broker for every node; local Civo uses the same proxy wire."""
    def call(self,node,request):
        if node!='civo':
            return super().call(node,request)
        value=self.nodes.get(node)
        if not value or value.get('qualified') is not True or (value.get('host'),value.get('port'))!=HOSTS[node]:
            raise PermissionError('local_worker_not_qualified_or_available')
        raw=contract.canonical(request).encode()
        return exchange(['/usr/bin/python3','-I','-B','/opt/peticao-dev-worker-broker/broker_proxy.py'],raw,self.timeout)
