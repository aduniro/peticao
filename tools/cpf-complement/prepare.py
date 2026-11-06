#!/usr/bin/env python3
"""Freeze the cohort and seed known CPFs; never calls an API or writes the app DB."""
import datetime
import hashlib
import hmac
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import sys

sys.path.insert(0, str(Path(__file__).parent))
import recover_cpfs as recovery

os.umask(0o077)
job = Path(sys.argv[1])
if job.parent != Path('/root/peticao-recovery/complementos'):
    raise RuntimeError('Unexpected destination')
key, database, port = recovery.read_settings(Path('/etc/peticao/app.env'))
query = """BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
 SELECT json_build_object('at',now(),'signatures',
 (SELECT coalesce(json_agg(to_jsonb(s) ORDER BY id),'[]') FROM signatures s WHERE cpf_hash IS NOT NULL));
 COMMIT;"""
proc = subprocess.run(['runuser','-u','postgres','--','psql','-X','-qAt','-v','ON_ERROR_STOP=1',
                      '-h','/var/run/postgresql','-p',port,'-d',database],
                       input=query,text=True,capture_output=True,check=True)
snapshot = json.loads(proc.stdout)
with (job/'snapshot.json').open('x') as f:
    json.dump(snapshot,f,ensure_ascii=False)
known = {}
for source in Path('/root/peticao-recovery/consolidacoes/consolidacao-20261106T104518Z/backup/fontes').glob('*.sqlite'):
    with sqlite3.connect(source.as_uri()+'?mode=ro',uri=True) as db:
        if db.execute("SELECT 1 FROM sqlite_master WHERE type='table' AND name='signatures'").fetchone():
            for cpf,digest in db.execute('SELECT cpf,cpf_hash FROM signatures WHERE cpf IS NOT NULL'):
                if hmac.new(key,cpf.encode(),hashlib.sha256).hexdigest()!=digest:
                    raise RuntimeError('CPF mapping mismatch')
                known[digest]=cpf
db=sqlite3.connect(job/'recuperacao.sqlite')
db.executescript('''CREATE TABLE metadata(key TEXT PRIMARY KEY,value TEXT);
 CREATE TABLE signatures(signature_id INTEGER PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,
 cpf_hash TEXT NOT NULL,original_cpf_name_check TEXT,original_created_at TEXT,original_consent_at TEXT,
 original_confirmed_at TEXT,cpf TEXT,recovered_at TEXT);''')
for r in snapshot['signatures']:
    cpf=known.get(r['cpf_hash'])
    db.execute('INSERT INTO signatures VALUES(?,?,?,?,?,?,?,?,?,?)',
        (r['id'],r['name'],r['category'],r['cpf_hash'],r['cpf_name_check'],r['created_at'],r['consent_at'],r['confirmed_at'],cpf,
         snapshot['at'] if cpf else None))
for k,v in {'snapshot_at':snapshot['at'],'selection':'all current CPF hashes; confirmed and pending',
            'key_check':hmac.new(key,b'peticao-cpf-recovery-key-check-v1',hashlib.sha256).hexdigest(),
            'next_base':'0','source_database':database,'state':'paused'}.items():
    recovery.set_meta(db,k,v)
db.commit()
total=db.execute('SELECT count(*) FROM signatures').fetchone()[0]
found=db.execute('SELECT count(*) FROM signatures WHERE cpf IS NOT NULL').fetchone()[0]
db.close()
status={'phase':'prepared','snapshot_at':snapshot['at'],'total':total,'cpfs_known':found,'cpfs_missing':total-found}
(job/'status.json').write_text(json.dumps(status,indent=2));print(json.dumps(status))
