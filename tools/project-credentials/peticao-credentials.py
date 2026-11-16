#!/usr/bin/env python3
"""Locate project credentials without printing secret values."""
import json,os,re,sys
from pathlib import Path
def main():
    catalog=Path.home()/'.config/peticao/shared-credentials/CATALOG.json'
    d=json.loads(catalog.read_text());args=sys.argv[1:]
    if not args or args[0]=='help':
        print('Usage: peticao-credentials list [text] | path ID | run ID ENVVAR COMMAND [ARGS...] | aws-profiles');return
    if args[0]=='aws-profiles':print('\n'.join(d['aws_profiles']));return
    if args[0]=='list':
        needle=args[1].lower()if len(args)>1 else''
        rows=[{'id':x['id'],'kind':x['kind'],'path':x['path'],'preferred':x['preferred']}for x in d['entries']if needle in (x['id']+' '+x['kind']).lower()]
        print(json.dumps(rows,ensure_ascii=False,indent=2));return
    if args[0]not in ['path','run']or len(args)<2:raise ValueError('Invalid usage')
    rows=[x for x in d['entries']if x['id']==args[1]]
    if len(rows)!=1:raise ValueError('Credential ID absent or ambiguous; use list')
    p=Path(rows[0]['path'])
    if args[0]=='path':print(p);return
    if len(args)<4 or not re.fullmatch(r'[A-Z_][A-Z0-9_]*',args[2]):raise ValueError('Expected ENVVAR COMMAND')
    if rows[0]['kind']not in ['api','github-token']:raise ValueError('run accepts a scalar API token only; consult catalog for structured configs')
    value=p.read_text().strip()
    if '\n'in value or not value:raise ValueError('Credential is not a scalar token')
    os.environ[args[2]]=value
    os.execvp(args[3],args[3:])
if __name__=='__main__':
    try:main()
    except Exception as e:print('Credential helper failed: '+type(e).__name__+' (secret details omitted)',file=sys.stderr);sys.exit(1)
