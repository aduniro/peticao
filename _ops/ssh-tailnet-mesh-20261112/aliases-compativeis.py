import json,shlex,subprocess
from pathlib import Path
P=Path(__file__).resolve().parent;nodes=json.loads((P/'installed.json').read_text())['nodes']
code="""import json,pwd,sys
from pathlib import Path
d=json.load(sys.stdin)
for user in [d['user'],'root']:
 p=Path(pwd.getpwnam(user).pw_dir)/'.ssh/config_peticao_tailnet_v2';s=p.read_text()
 for peer in ['local','sp','santiago','waha','akamai']:
  for root in [False,True]:
   original='Host peticao-'+peer+('-root' if root else '')+'-tailnet'
   addition=original+' cluster-'+peer+('-root' if root else '')
   if addition not in s:s=s.replace(original+'\\n',addition+'\\n')
 p.write_text(s);p.chmod(0o600)
print(json.dumps({'aliasesCompatible':True}))
"""
for n in nodes:
 cmd=['ssh','-o','BatchMode=yes','peticao-'+n['id']+'-root-tailnet','python3 -c '+shlex.quote(code)]
 r=subprocess.run(cmd,input=json.dumps(n),capture_output=True,text=True,timeout=20);assert r.returncode==0,r.stderr
print('Aliases cluster-local/sp/santiago/waha/akamai e variantes -root configurados em todas as contas.')
