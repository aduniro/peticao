"""Project credential replication. Secret payloads only in memory/SSH stdin."""
import base64,configparser,datetime,hashlib,io,json,os,pwd,re,shlex,shutil,stat,subprocess,sys,uuid
from pathlib import Path

HOSTS = [
 {'name':'dell','user':'barre','alias':None},
 {'name':'civo','user':'civo','alias':'cluster-civo-root'},
 {'name':'oracle','user':'builder','alias':'cluster-oracle-root'},
 {'name':'akamai','user':'builder','alias':'cluster-akamai-root'},
 {'name':'santiago','user':'sonda','alias':'cluster-santiago-root'},
 {'name':'waha','user':'wa','alias':'cluster-waha-root'},
 {'name':'sp','user':'adunir','alias':'cluster-sp-root'},
 {'name':'azure','user':'builder','alias':'cluster-azure-root'},
]
BASE = Path(__file__).parent
EXCLUDE = ('brave-playwright-extension-token',)

def digest(data): return hashlib.sha256(data).hexdigest()
def b64(data): return base64.b64encode(data).decode()
def unb64(text): return base64.b64decode(text,validate=True)
def timestamp(): return datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')

def harvest(host):
    result={'host':host['name'],'files':[],'aws':[],'unavailable':[]}
    def add(path,rel,kind,origin):
        if path.is_file() and not path.is_symlink():
            try:data=path.read_bytes()
            except PermissionError:
                result['unavailable'].append('unreadable:'+rel);return
            result['files'].append({'rel':rel,'kind':kind,'origin':origin,'data':b64(data)})
    accounts=[host['user']]
    if os.geteuid()==0:accounts.append('root')
    for account in dict.fromkeys(accounts):
        try:home=Path(pwd.getpwnam(account).pw_dir)
        except KeyError:result['unavailable'].append('account:'+account);continue
        origin=host['name']+'/'+account
        folder=home/'.config/peticao/credentials'
        if folder.is_dir():
            for p in sorted(folder.iterdir()):
                if p.name in EXCLUDE or any(s in p.name for s in ['.backup-','.new-','.bak','before-']):continue
                add(p,'sources/'+origin+'/api/'+p.name,'api',origin)
        add(home/'.config/peticao-infra/keys.env','sources/'+origin+'/legacy/keys.env','legacy-env',origin)
        folder=home/'.ssh'
        if folder.is_dir():
            for p in sorted(folder.iterdir()):
                name=p.name
                if name=='id_ed25519_peticao_rdp':continue
                if any(s in name for s in ['backup','before-','.old','.bak']):continue
                if name.startswith('id_') and (any(s in name for s in ['peticao','admin_v2','sonda'])or name in ['id_ed25519_civo','id_ed25519_civo.pub']):
                    add(p,'sources/'+origin+'/ssh/'+name,'ssh-public'if name.endswith('.pub')else'ssh-private',origin)
        credentials=home/'.aws/credentials';config=home/'.aws/config'
        if credentials.is_file():
            c=configparser.RawConfigParser();c.read(credentials)
            cfg=configparser.RawConfigParser();cfg.read(config)
            for profile in c.sections():
                if not profile.startswith('peticao'):continue
                values=dict(c[profile])
                if not values.get('aws_access_key_id','').startswith('AKIA'):continue
                if not values.get('aws_secret_access_key'):continue
                region=cfg.get('profile '+profile,'region',fallback='sa-east-1'if 'ses'in profile else'us-east-1')
                result['aws'].append({'name':profile,'values':values,'region':region,'origin':origin})
        for relative in ['.config/linode-cli','.config/scw/config.yaml','.config/ovhcloud/ovhcloud.conf','.config/ovhcloud/ovhcloud.yaml','.ovh.conf']:
            p=home/relative
            add(p,'sources/'+origin+'/native/'+relative.lstrip('.'),'native-config',origin)
        oci=home/'.oci/peticao-oracle/config'
        if oci.is_file():
            add(oci,'sources/'+origin+'/native/oci/config','oci-config',origin)
            c=configparser.RawConfigParser();c.read(oci)
            for section in c.sections():
                key=c.get(section,'key_file',fallback='')
                if key:
                    path=Path(key).expanduser()
                    if not path.is_absolute():path=oci.parent/path
                    if path.is_file():add(path,'sources/'+origin+'/native/oci/'+path.name,'oci-api-key',origin)
                    else:result['unavailable'].append('oci_key_file:'+origin+'/'+section)
        token=home/'.config/peticao/github/aduniro/token'
        add(token,'sources/'+origin+'/api/github-aduniro-token','github-token',origin)
        if host['name']=='dell' and account=='barre' and os.geteuid()==pwd.getpwnam(account).pw_uid and shutil.which('gh'):
            for user in ['barretobrunosb','democracia-popular']:
                try:p=subprocess.run(['gh','auth','token','--hostname','github.com','--user',user],capture_output=True,text=True,timeout=20)
                except subprocess.TimeoutExpired:
                    result['unavailable'].append('github_token:'+user+':timeout');continue
                if p.returncode==0 and p.stdout.strip():
                    result['files'].append({'rel':'sources/'+origin+'/api/github-'+user+'-token','kind':'github-token','origin':origin,'data':b64((p.stdout.strip()+'\n').encode())})
                else:result['unavailable'].append('github_token:'+user)
    return result

def safe(path):
    if not os.path.lexists(path):return
    s=path.lstat()
    if not stat.S_ISREG(s.st_mode)or s.st_uid!=os.geteuid()or s.st_nlink!=1:raise RuntimeError('Unsafe existing file: '+path.name)

def directory(path):
    for p in (path,*path.parents):
        if p.is_symlink():raise RuntimeError('Symlink directory refused')
    path.mkdir(parents=True,mode=0o700,exist_ok=True)
    if path.stat().st_uid!=os.geteuid():raise RuntimeError('Directory owner mismatch')
    path.chmod(0o700);return path

def write(path,data,backups):
    directory(path.parent);safe(path)
    if path.exists() and path.read_bytes()==data:
        path.chmod(0o600);return False
    if path.exists():
        directory(backups)
        p=backups/(path.name+'.'+uuid.uuid4().hex)
        fd=os.open(p,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'wb')as f:f.write(path.read_bytes());f.flush();os.fsync(f.fileno())
    temp=path.with_name('.'+path.name+'.new-'+uuid.uuid4().hex)
    fd=os.open(temp,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'wb')as f:f.write(data);f.flush();os.fsync(f.fileno())
    os.replace(temp,path)
    return True

def install(bundle,account):
    home=Path.home();root=directory(home/'.config/peticao/shared-credentials');backups=root/'backups'/bundle['id']
    catalog=[];changed=0;checked=0
    for entry in bundle['files']:
        rel=Path(entry['rel'])
        if rel.is_absolute()or '..'in rel.parts:raise RuntimeError('Unsafe relative path')
        data=unb64(entry['data']);path=root/'current'/rel
        if entry['kind']=='oci-config':
            cfg=configparser.RawConfigParser();cfg.read_string(data.decode())
            for section in cfg.sections():
                old=cfg.get(section,'key_file',fallback='')
                if old:cfg.set(section,'key_file',str(path.parent/Path(old).name))
            buf=io.StringIO();cfg.write(buf);data=buf.getvalue().encode()
        changed+=write(path,data,backups);checked+=1
        if digest(path.read_bytes())!=digest(data)or stat.S_IMODE(path.stat().st_mode)!=0o600:raise RuntimeError('Replica verification failed')
        catalog.append({'id':entry['id'],'kind':entry['kind'],'path':str(path),'origin':entry['origin'],'preferred':entry.get('preferred',False)})
        if entry.get('preferred') and entry['kind']in ['api','github-token']:
            dest=home/'.config/peticao/credentials'/Path(entry['rel']).name
            # Keep existing differing credentials usable at their old location; new copy has explicit catalog path.
            if not dest.exists()or dest.read_bytes()==data:changed+=write(dest,data,backups)
    awsdir=directory(home/'.aws');credentials=awsdir/'credentials';config=awsdir/'config'
    for p in [credentials,config]:safe(p)
    old_credentials=credentials.read_text()if credentials.exists()else''
    old_config=config.read_text()if config.exists()else''
    c=configparser.RawConfigParser();c.read_string(old_credentials)
    cfg=configparser.RawConfigParser();cfg.read_string(old_config)
    add_credentials='';add_config='';aws_results=[]
    for profile in bundle['aws']:
        name=profile['name'];values=profile['values']
        if c.has_section(name)and dict(c[name])!=values:
            name=name+'--shared-'+profile['origin'].replace('/','-')
        if c.has_section(name)and dict(c[name])!=values:raise RuntimeError('AWS profile alias conflict')
        if not c.has_section(name):
            c.add_section(name)
            for key,value in values.items():c.set(name,key,value)
            add_credentials+='\n['+name+']\n'+''.join(key+' = '+value+'\n'for key,value in values.items())
        section='profile '+name
        if not cfg.has_section(section):
            cfg.add_section(section);add_config+='\n['+section+']\nregion = '+profile['region']+'\noutput = json\n'
        aws_results.append(name)
    if add_credentials:changed+=write(credentials,(old_credentials+'\n'+add_credentials).encode(),backups)
    if add_config:changed+=write(config,(old_config+'\n'+add_config).encode(),backups)
    for p in [credentials,config]:
        if p.exists():p.chmod(0o600)
    # Verify all newly addressed native AWS profiles without emitting any key material.
    check=configparser.RawConfigParser();check.read(credentials)
    for name in aws_results:
        if not check.has_section(name):raise RuntimeError('Native AWS profile missing')
    index={'version':1,'sync_id':bundle['id'],'account':account,'home':str(home),'entries':catalog,'aws_profiles':aws_results,'exceptions':bundle['exceptions'],'limits':bundle['limits']}
    changed+=write(root/'CATALOG.json',(json.dumps(index,ensure_ascii=False,indent=2)+'\n').encode(),backups)
    readme=bundle['instructions'].replace('{HOME}',str(home))
    changed+=write(root/'README.md',readme.encode(),backups)
    helper=home/'.local/bin/peticao-credentials';changed+=write(helper,bundle['helper'].encode(),backups);helper.chmod(0o700)
    pointer=home/'.config/peticao/CREDENTIALS.md';write(pointer,readme.encode(),backups)
    # Global agent guidance points to the local catalog; no auth, history, or sessions are copied.
    agent=home/'.codex/AGENTS.md';safe(agent)
    marker='## Credenciais compartilhadas do projeto Petição'
    original=agent.read_text()if agent.exists()else''
    if marker not in original:
        guide='\n'+marker+'\n\nPara tarefas do projeto, consulte `'+str(pointer)+'` e o catálogo `'+str(root/'CATALOG.json')+'`. Use `'+str(home/'.local/bin/peticao-credentials')+' list <serviço>` para encontrar caminhos sem exibir valores. Preserve permissões e a autorização da tarefa; não imprimir/copiar segredos em logs ou Git. Certificados compartilhados são TESTES/DEV; app em operação e seu fluxo permanecem na VPS São Paulo.\n'
        changed+=write(agent,(original+guide).encode(),backups)
    exports={'PETICAO_CREDENTIAL_CATALOG':str(root/'CATALOG.json'),'PETICAO_CREDENTIAL_GUIDE':str(pointer),
             'PETICAO_AWS_CREDENTIALS_FILE':str(credentials)}
    for item in catalog:
        field={'dev/a1-test-pfx':'PETICAO_A1_TEST_PFX','dev/a1-test-password':'PETICAO_A1_TEST_PASSWORD_FILE','dev/a1-test-roots':'PETICAO_A1_TEST_ROOTS','dev/a1-test-crl':'PETICAO_A1_TEST_CRL'}.get(item['id'])
        if field:exports[field]=item['path']
    envfile=home/'.config/peticao/credential-paths.sh'
    write(envfile,(''.join('export '+key+'='+shlex.quote(value)+'\n'for key,value in exports.items())).encode(),backups)
    # Azure launcher reads protected credential file at the standard HOME path.
    if bundle.get('azure_launcher'):
        helper=home/'.local/share/peticao/azure-admin-key-setup/azure_admin_key.py'
        changed+=write(helper,bundle['azure_launcher'].encode(),backups);helper.chmod(0o700)
    # mkdir(parents=True) can leave intermediate directories with default mode; harden the private tree.
    for folder in [root,*[p for p in root.rglob('*')if p.is_dir()and not p.is_symlink()]]:
        if folder.stat().st_uid!=os.geteuid():raise RuntimeError('Private directory owner mismatch')
        folder.chmod(0o700)
    return {'account':account,'home':str(home),'secret_files_integrity_checked':checked,'catalog_entries':len(catalog),'aws_profiles':aws_results,'files_changed':changed,'catalog':str(root/'CATALOG.json'),'instructions':str(pointer),'helper':str(home/'.local/bin/peticao-credentials'),'status':'PASS'}

def as_account(bundle,account):
    # Separate short-lived process; never changes caller identity.
    if os.geteuid()==0:
        u=pwd.getpwnam(account)
        os.initgroups(u.pw_name,u.pw_gid);os.setgid(u.pw_gid);os.setuid(u.pw_uid);os.environ['HOME']=u.pw_dir
    elif pwd.getpwuid(os.geteuid()).pw_name!=account:raise RuntimeError('Wrong account')
    return install(bundle,account)

def entry():
    os.umask(0o077)
    action=sys.argv[1]
    if action=='harvest':print(json.dumps(harvest(json.load(sys.stdin))));return
    if action=='install':
        p=json.load(sys.stdin);print(json.dumps(as_account(p['bundle'],p['account'])));return

if __name__=='__main__':
    try:entry()
    except Exception as e:
        # Config parsers and subprocess errors can contain secret values; never print their text.
        print(json.dumps({'status':'FAIL','error_type':type(e).__name__,'details':'omitted to protect credentials'}));sys.exit(1)
