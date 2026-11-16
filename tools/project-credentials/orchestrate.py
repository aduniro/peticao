"""Run private harvest/install subprocesses; emit metadata only."""
import concurrent.futures,importlib.util,json,os,shlex,subprocess,sys,datetime
from pathlib import Path
base=Path(__file__).parent
spec=importlib.util.spec_from_file_location('vault',base/'vault_sync.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
source=(base/'vault_sync.py').read_text()
bootstrap='''import json,sys
p=json.load(sys.stdin)
n={'__name__':'credential_sync','__file__':'credential-sync.py'}
exec(compile(p['source'],'<project-credential-sync>','exec'),n)
try:
 if p['action']=='harvest':r=n['harvest'](p['host'])
 else:r=n['as_account'](p['bundle'],p['account'])
 print(json.dumps(r))
except Exception as e:
 print(json.dumps({'status':'FAIL','error_type':type(e).__name__,'details':'omitted to protect credentials'}));sys.exit(1)
'''

def invoke(host,payload,timeout=120):
    payload={'source':source,**payload}
    alias=host['alias']or'cluster-local-root'
    r=subprocess.run(['ssh','-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=15',alias,'python3 -c '+shlex.quote(bootstrap)],input=json.dumps(payload),text=True,capture_output=True,timeout=timeout)
    if r.returncode:
        # Never print raw stdout: successful harvest contains secrets.
        raise RuntimeError('Private SSH operation failed for '+host['name']+' (exit '+str(r.returncode)+')')
    return json.loads(r.stdout)

def collect(host):
    result=invoke(host,{'action':'harvest','host':host})
    print(json.dumps({'stage':'harvest','host':host['name'],'files':len(result['files']),'aws_profiles':len(result['aws']),'unavailable':result['unavailable']}),flush=True)
    return result

def main():
    os.umask(0o077)
    if '--from-local-replica'in sys.argv:
        index=json.loads((Path.home()/'.config/peticao/shared-credentials/CATALOG.json').read_text())
        root=Path.home()/'.config/peticao/shared-credentials/current'
        files=[]
        for item in index['entries']:
            if item['id'].startswith('dev/a1-test-'):continue
            p=Path(item['path'])
            files.append({'rel':str(p.relative_to(root)),'id':item['id'],'kind':item['kind'],'origin':item['origin'],'preferred':item['preferred'],'data':m.b64(p.read_bytes())})
        import configparser
        c=configparser.RawConfigParser();c.read(Path.home()/'.aws/credentials')
        cfg=configparser.RawConfigParser();cfg.read(Path.home()/'.aws/config')
        profiles=[{'name':name,'values':dict(c[name]),'region':cfg.get('profile '+name,'region',fallback='us-east-1'),'origin':'dell/barre'}for name in index['aws_profiles']]
        harvested=[{'host':'dell','files':files,'aws':profiles,'unavailable':[]}];fail=[]
        print(json.dumps({'stage':'reuse_verified_replica','original_sync':index['sync_id'],'files':len(files),'aws_profiles':len(profiles)}),flush=True)
    else:
        local=m.harvest({'name':'dell','user':'barre','alias':None})
        harvested=[local];fail=[]
        with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
            futures={pool.submit(collect,h):h for h in m.HOSTS}
            for future in concurrent.futures.as_completed(futures):
                host=futures[future]
                try:harvested.append(future.result())
                except Exception as e:fail.append({'stage':'harvest','host':host['name'],'error_type':type(e).__name__});print(json.dumps(fail[-1]),flush=True)
    if fail:
        (base/'HARVEST-FAILURES.json').write_text(json.dumps(fail,indent=2));raise RuntimeError('Some sources unreachable; no distribution started')
    files=[];seen=set()
    for group in harvested:
        for entry in group['files']:
            # Root harvester also saw the normal user's files; keep one copy per exact source path.
            if entry['rel']in seen:continue
            seen.add(entry['rel']);entry['id']=entry['rel'];files.append(entry)
    api={}
    def rank(entry):
        return (0 if entry['origin']=='dell/barre'else 1 if entry['origin']=='civo/civo'else 2,entry['origin'])
    for entry in sorted(files,key=rank):
        if entry['kind']in ['api','github-token']:
            name=Path(entry['rel']).name
            if name not in api:api[name]=entry;entry['preferred']=True;entry['id']='api/'+name
    aws=[];profile_values={}
    for group in sorted(harvested,key=lambda g:0 if g['host']=='dell'else 1 if g['host']=='civo'else 2):
        for entry in group['aws']:
            signature=(entry['name'],json.dumps(entry['values'],sort_keys=True))
            if signature in profile_values:continue
            profile_values[signature]=True;aws.append(entry)
    # Owner explicitly authorized sharing the development certificate. Attest its exact existing fixture.
    fixture=base/'DEV-FIXTURE-METADATA.json'
    if not fixture.exists():fixture=Path('/mnt/apps/peticao-final/_ops/a1-habilitacao-20261112/credential-e2e-fixture.private.json')
    dev=json.loads(fixture.read_text())
    if dev.get('syntheticOnly')is not True or dev.get('notIcpHomologation')is not True:
        raise RuntimeError('Development certificate provenance not established')
    from cryptography.hazmat.primitives.serialization import pkcs12
    from cryptography.hazmat.primitives import hashes
    private,cert,chain=pkcs12.load_key_and_certificates(Path(dev['pfxPath']).read_bytes(),Path(dev['passwordPath']).read_bytes().strip())
    if private is None or cert is None:raise RuntimeError('Development PKCS12 incomplete')
    fingerprint=cert.fingerprint(hashes.SHA256()).hex()
    if fingerprint.lower()!=dev['certificateFingerprintSha256'].replace(':','').lower():
        raise RuntimeError('Development certificate differs from attested fixture')
    for field,name,kind in [('pfxPath','certificate.pfx','dev-certificate'),('passwordPath','certificate-password','dev-certificate-password'),('rootsPath','roots.pem','dev-trust'),('crlPath','issuer.crl','dev-trust')]:
        data=Path(dev[field]).read_bytes()
        files.append({'rel':'development/a1-synthetic/'+name,'id':'dev/a1-test-'+{'pfxPath':'pfx','passwordPath':'password','rootsPath':'roots','crlPath':'crl'}[field],
                      'kind':kind,'origin':'dell/barre/development-synthetic-fixture','data':m.b64(data)})
    bundle={'id':m.timestamp(),'files':files,'aws':aws,
            'exceptions':['Remmina private key remains on Dell','No Codex sessions/auth/cookies','No production signing material or personal credentials outside identified project scope'],
            'limits':[x for h in harvested for x in h['unavailable']if not(x.startswith('unreadable:')and x[len('unreadable:'):]in seen)],
            'helper':(base/'peticao-credentials.py').read_text(),
            'instructions':(base/'INSTRUCTIONS.md').read_text(),
            'azure_launcher':Path('/home/barre/.local/share/peticao/azure-admin-key-setup/azure_admin_key.py').read_text()}
    # No secret payload is written to a staging file. All SSH transfers use stdin.
    manifest={'sync_id':bundle['id'],'source_hosts':[h['name']for h in m.HOSTS],
              'files':len(files),'preferred_files':sorted(api),'aws_profile_names':sorted(set(x['name']for x in aws)),
              'development_certificate':{'synthetic_only':True,'source_fixture':str(fixture),'fingerprint_sha256':fingerprint,'expires_at':(cert.not_valid_after_utc if hasattr(cert,'not_valid_after_utc')else cert.not_valid_after.replace(tzinfo=datetime.timezone.utc)).isoformat()},
              'exceptions':bundle['exceptions'],'unavailable_sources':bundle['limits']}
    (base/'MANIFEST.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({'stage':'prepared',**manifest}),flush=True)
    results=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
        futures={pool.submit(invoke,h,{'action':'install','bundle':bundle,'account':account},240):(h,account)for h in m.HOSTS for account in dict.fromkeys([h['user'],'root'])}
        for future in concurrent.futures.as_completed(futures):
            h,account=futures[future]
            try:r=future.result();r['host']=h['name'];results.append(r);print(json.dumps(r),flush=True)
            except Exception as e:
                results.append({'host':h['name'],'account':account,'status':'FAIL','error_type':type(e).__name__});print(json.dumps(results[-1]),flush=True)
    (base/'RESULTS.json').write_text(json.dumps(results,indent=2))
    if any(r['status']!='PASS'for r in results):raise RuntimeError('Some replicas incomplete; inspect sanitized results')
    print(json.dumps({'stage':'completed','hosts':len(m.HOSTS),'accounts':len(results),'status':'PASS'}),flush=True)

if __name__=='__main__':
    try:main()
    except Exception as e:print(json.dumps({'status':'FAIL','error_type':type(e).__name__,'details':'omitted to protect credentials'}));sys.exit(1)
