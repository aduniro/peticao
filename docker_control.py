from pathlib import Path
import os,json,re,subprocess
ROOT=Path('/mnt/dev/.peticao-r0009-local-package-http-qa-20261111')
IMAGE="sha256:665dc7b37ac52a17e298511414c21d23ffa4e6a6ef6225b3e5d59c7afb35e994"
LABEL="org.peticao.qa.local-r0009"
PORT=55489
def call(args,timeout=15):
 # No shell, inherited credentials/config or retry. Docker uses only local socket.
 return subprocess.run(args,text=True,capture_output=True,check=True,timeout=timeout,env={'PATH':'/usr/bin:/bin','HOME':str(ROOT/'empty'),'LANG':'C.UTF-8','DOCKER_HOST':'unix:///var/run/docker.sock'})

def docker(*args,timeout=15):return call(['/usr/bin/docker',*args],timeout=timeout)

def owned_labels(nonce):return {LABEL:nonce,LABEL+'.uid':str(os.getuid()),LABEL+'.scope':'fixture-only'}

def verify_owned(obj,nonce,kind):
 if type(obj)is not dict:raise ValueError('Docker object required')
 labels=obj.get('Labels',obj.get('Config',{}).get('Labels',{}))or{};expected_labels=owned_labels(nonce)
 if any(labels.get(k)!=v for k,v in expected_labels.items())or any(k.startswith(LABEL)and k not in expected_labels for k in labels):raise ValueError('foreign or changed Docker labels')
 value=obj.get('Id','')
 if not re.fullmatch('[a-f0-9]{64}',value):raise ValueError('exact Docker ID required')
 expected='peticao-r0009-'+nonce+('-net'if kind=='network'else'-pg')
 if obj.get('Name','').lstrip('/')!=expected:raise ValueError('Docker name changed')
 return value

def inspect_owned(name,nonce,kind):
 args=['network','inspect',name]if kind=='network'else['inspect','--type','container',name]
 values=json.loads(docker(*args).stdout)
 if type(values)is not list or len(values)!=1:raise ValueError('single Docker identity required')
 verify_owned(values[0],nonce,kind);return values[0]

def label_flags(nonce):
 return [item for key,value in owned_labels(nonce).items()for item in ['--label',key+'='+value]]

def network_args(nonce):return ['network','create','--driver','bridge',*label_flags(nonce),'peticao-r0009-'+nonce+'-net']

def container_args(nonce,nid):
 return ['create','--pull=never','--name','peticao-r0009-'+nonce+'-pg',*label_flags(nonce),'--network',nid,'--publish','127.0.0.1:55489:5432','--cpus=1','--memory=512m','--memory-swap=512m','--pids-limit=128','--read-only','--tmpfs','/var/lib/postgresql/data:rw,size=256m','--tmpfs','/var/run/postgresql:rw,size=16m','--tmpfs','/tmp:rw,size=16m','--env','POSTGRES_USER=fixture_only','--env','POSTGRES_PASSWORD=fixture_only','--env','POSTGRES_DB=fixture_only',IMAGE,'-c','cluster_name='+nonce]

def validate_container(obj,nonce,nid,*,phase='before_start',expected_cid=None):
 cid=verify_owned(obj,nonce,'container');h=obj['HostConfig'];bindings={'5432/tcp':[{'HostIp':'127.0.0.1','HostPort':'55489'}]}
 if expected_cid is not None and cid!=expected_cid:raise ValueError('container ID changed after create')
 if obj['Image']!=IMAGE or h['PortBindings']!=bindings or h['Memory']!=512*1024**2 or h['NanoCpus']!=10**9 or h['PidsLimit']!=128 or not h['ReadonlyRootfs']or h.get('Binds')or set(h.get('Tmpfs',{}))!={'/var/lib/postgresql/data','/var/run/postgresql','/tmp'}:raise ValueError('Docker isolation drift')
 # create config binds the exact owned network ID even before Docker allocates its endpoint.
 if h.get('NetworkMode')!=nid:raise ValueError('configured network ID changed')
 networks=obj['NetworkSettings']['Networks'];network_name='peticao-r0009-'+nonce+'-net'
 if len(networks)!=1 or next(iter(networks))not in {network_name,nid}:raise ValueError('unexpected Docker network map')
 actual=next(iter(networks.values())).get('NetworkID');state=obj.get('State',{})
 if phase=='before_start':
  if state.get('Status')!='created'or state.get('Running')is not False or actual not in {'',nid}:raise ValueError('created container/endpoint identity changed')
 elif phase=='after_start':
  if state.get('Status')!='running'or state.get('Running')is not True or actual!=nid:raise ValueError('running container endpoint not proven')
 else:raise ValueError('unknown container lifecycle phase')
 return cid

def cleanup(nonce,*,expected_cid=None,expected_nid=None):
 # Inspect exact nonce/name/ID again before every control command; never prune.
 proof={};errors=[]
 for kind,name in [('container','peticao-r0009-'+nonce+'-pg'),('network','peticao-r0009-'+nonce+'-net')]:
  try:
   args=['network','ls','--filter','name=^'+name+'$','--format','{{.ID}}']if kind=='network'else['ps','--all','--filter','name=^/'+name+'$','--format','{{.ID}}']
   if not docker(*args).stdout.strip():proof[kind+'Absent']=True;continue
   obj=inspect_owned(name,nonce,kind);oid=verify_owned(obj,nonce,kind)
   expected_id=expected_cid if kind=='container'else expected_nid
   if expected_id is not None and oid!=expected_id:raise ValueError('owned Docker ID changed; do not remove replacement')
   if kind=='container'and obj.get('Image')!=IMAGE:raise ValueError('container image changed; do not remove')
   if kind=='network'and (obj.get('Driver')!='bridge'or obj.get('Internal')is not False):raise ValueError('network config changed; do not remove')
   docker(*(['rm','--force',oid]if kind=='container'else['network','rm',oid]),timeout=25)
   # Inspection uses list metadata only; a zero rm exit is not the sole proof.
   if docker(*args).stdout.strip():raise ValueError('owned Docker resource still visible')
   proof[kind+'Removed']=True
  except BaseException as exc:errors.append(kind+': '+type(exc).__name__+': '+str(exc)[:300])
 if errors:proof['cleanupErrors']=errors
 return proof
