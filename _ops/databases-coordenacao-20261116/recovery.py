"""Private metadata backup and isolated restoration. No production database access."""
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import urllib.parse
from psycopg import sql
from psycopg.types.json import Jsonb
from coordination import Store,canonical
from neon_admin import Api,PROJECT,PRIVATE,EVIDENCE,save

TABLES=['migrations','agents','tasks','dependencies','events','decisions','ledger_snapshots','queue_snapshots','queue_projection']


def capture(store):
    tables={}
    with store.connect(direct=True) as db:
        db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY')
        for table in TABLES:
            rows=db.execute(sql.SQL('SELECT * FROM peticao_coord.{}').format(sql.Identifier(table))).fetchall()
            rows=json.loads(json.dumps(rows,default=str))
            tables[table]=sorted(rows,key=canonical)
    return tables


def checks(tables):
    return {t:{'count':len(rows),'sha256':hashlib.sha256(canonical(rows).encode()).hexdigest()} for t,rows in tables.items()}


def run():
    original=Store(PRIVATE/'migration-config.json');tables=capture(original)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    archive=PRIVATE/'backups'/f'coordination-{stamp}.json'
    envelope={'format':1,'project':original.settings['project_id'],'branch':original.settings['branch_id'],'tables':tables}
    envelope['sha256']=hashlib.sha256(canonical(envelope).encode()).hexdigest()
    save(archive,envelope,private=True)
    reread=json.loads(archive.read_text());sha=reread.pop('sha256')
    if hashlib.sha256(canonical(reread).encode()).hexdigest()!=sha:raise ValueError('backup_checksum_mismatch')
    restored_db='peticao_coordination_restore_'+stamp.lower()
    bid=original.settings['branch_id'];api=Api('api/peticao-neon1')
    owner_name=urllib.parse.unquote(urllib.parse.urlsplit(original.settings['direct_uri']).username)
    api.call(f'projects/{PROJECT}/branches/{bid}/databases',{'database':{'name':restored_db,'owner_name':owner_name}})
    config=dict(original.settings,database=restored_db)
    for k in ['direct_uri','pooled_uri']:
        u=urllib.parse.urlsplit(config[k]);config[k]=urllib.parse.urlunsplit((u.scheme,u.netloc,'/'+restored_db,u.query,''))
    path=PRIVATE/'recovery-config.json';save(path,config,private=True)
    restored=Store(path);restored.migrate()
    with restored.connect(direct=True) as db:
        for table in TABLES:
            if table=='migrations':
                # Schema checksums were checked by migrate(); preserve the original
                # application timestamps as well, rather than claiming a byte-exact restore otherwise.
                for row in tables[table]:
                    changed=db.execute('UPDATE peticao_coord.migrations SET applied_at=%s WHERE version=%s AND sha256=%s RETURNING version',
                                       (row['applied_at'],row['version'],row['sha256'])).fetchone()
                    if not changed:raise ValueError('restore_migration_history_mismatch')
                continue
            for row in tables[table]:
                columns=list(row)
                query=sql.SQL('INSERT INTO peticao_coord.{} ({}) OVERRIDING SYSTEM VALUE VALUES ({})').format(
                    sql.Identifier(table),sql.SQL(',').join(map(sql.Identifier,columns)),sql.SQL(',').join(sql.Placeholder() for _ in columns))
                values=[Jsonb(v) if isinstance(v,(dict,list)) else v for v in row.values()]
                db.execute(query,values)
        db.execute("SELECT setval('peticao_coord.fences',GREATEST(COALESCE((SELECT MAX(fence) FROM peticao_coord.tasks),0),COALESCE((SELECT MAX(fence) FROM peticao_coord.events),0))+1,false)")
        db.execute("SELECT setval(pg_get_serial_sequence('peticao_coord.events','seq'),COALESCE((SELECT MAX(seq) FROM peticao_coord.events),0)+1,false)")
    result={'at':stamp,'backup_private_path':str(archive),'backup_sha256':sha,'restore_database':restored_db,
            'source_counts_hashes':checks(tables),'restore_counts_hashes':checks(capture(restored)),
            'mode':'isolated','production_accessed':False}
    result['all_tables_match']=result['source_counts_hashes']==result['restore_counts_hashes']
    save(EVIDENCE/'RECOVERY.json',result);print(json.dumps(result))
    if not result['all_tables_match']:raise ValueError('restore_verification_failed')


if __name__=='__main__':
    os.umask(0o077)
    try:run()
    except Exception as e:print(json.dumps({'error':type(e).__name__}));raise SystemExit(2)
