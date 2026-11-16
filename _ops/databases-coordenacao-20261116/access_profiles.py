"""Create scoped runtime roles in the isolated branch. Never print credentials."""
import json
import os
from pathlib import Path
import secrets
import urllib.parse
import psycopg
from psycopg import sql
from coordination import Store
from neon_admin import PRIVATE, EVIDENCE, save


def main():
    owner_path=PRIVATE/'migration-config.json'
    if not owner_path.exists():save(owner_path,json.loads((PRIVATE/'config.json').read_text()),private=True)
    owner=Store(owner_path)
    for role,filename,writable in [('peticao_coord_reader','query-config.json',False),('peticao_coord_writer','config.json',True)]:
        path=PRIVATE/filename
        current=json.loads(path.read_text()) if path.exists() else None
        with owner.connect(direct=True) as db:
            exists=db.execute('SELECT 1 FROM pg_roles WHERE rolname=%s',(role,)).fetchone()
            if not exists:
                password=secrets.token_urlsafe(36)
                db.execute(sql.SQL('CREATE ROLE {} LOGIN NOINHERIT NOCREATEDB NOCREATEROLE PASSWORD {}').format(sql.Identifier(role),sql.Literal(password)))
            else:
                if not current or current.get('role')!=role:raise RuntimeError('existing_role_without_matching_local_profile')
                password=urllib.parse.unquote(urllib.parse.urlsplit(current['direct_uri']).password)
            db.execute(sql.SQL('GRANT CONNECT ON DATABASE peticao_coordination TO {}').format(sql.Identifier(role)))
            db.execute(sql.SQL('GRANT USAGE ON SCHEMA peticao_coord TO {}').format(sql.Identifier(role)))
            privileges=sql.SQL('SELECT,INSERT,UPDATE') if writable else sql.SQL('SELECT')
            db.execute(sql.SQL('GRANT {} ON ALL TABLES IN SCHEMA peticao_coord TO {}').format(privileges,sql.Identifier(role)))
            if writable:db.execute(sql.SQL('GRANT USAGE ON ALL SEQUENCES IN SCHEMA peticao_coord TO {}').format(sql.Identifier(role)))
        config=dict(owner.settings,role=role,access='metadata-write' if writable else 'read-only')
        for field in ['direct_uri','pooled_uri']:
            u=urllib.parse.urlsplit(config[field]);authority=urllib.parse.quote(role,safe='')+':'+urllib.parse.quote(password,safe='')+'@'+u.hostname
            config[field]=urllib.parse.urlunsplit((u.scheme,authority,u.path,u.query,u.fragment))
        save(path,config,private=True)
        with Store(path).connect() as db:db.execute('SELECT 1')
    result={'runtime_config':str(PRIVATE/'config.json'),'read_config':str(PRIVATE/'query-config.json'),
            'migration_config_local_only':str(owner_path),'roles':['peticao_coord_reader','peticao_coord_writer'],
            'source':'isolated_branch_only','no_role_creation_or_db_creation_privilege':True}
    save(EVIDENCE/'ACCESS-PROFILES.json',result);print(json.dumps(result))


if __name__=='__main__':
    os.umask(0o077)
    try:main()
    except Exception as e:print(json.dumps({'error':type(e).__name__}));raise SystemExit(2)
