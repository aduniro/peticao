#!/usr/bin/env python3
"""Read-only verification of protected signature fields and full audit chain."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

database, snapshot_file, applied_file, output = sys.argv[1:]
if database != 'peticao' and not database.startswith('cpf_audit_'):
    raise RuntimeError('Unexpected database')
proc = subprocess.run(['runuser','-u','postgres','--','psql','-X','-qAt',
    '-d',database,'-v','ON_ERROR_STOP=1'], input="""
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT json_build_object(
 'signatures',(SELECT json_agg(to_jsonb(s)) FROM signatures s),
 'audit',(SELECT json_agg(to_jsonb(a) ORDER BY id) FROM audit_log a));
COMMIT;
""", text=True,capture_output=True,check=True)
data = json.loads(proc.stdout)
prior = {r['id']:r for r in json.loads(Path(snapshot_file).read_text())['signatures']}
changed = set(json.loads(Path(applied_file).read_text())['updated_ids'])
protected_errors, unexpected_changes = [], []
for row in data['signatures']:
    old = prior.get(row['id'])
    if not old:
        continue  # New signatures are independent of this frozen consolidation.
    if row['id'] in changed:
        if row['cpf_name_check'] != 'match' or {k:v for k,v in row.items() if k!='cpf_name_check'} != {k:v for k,v in old.items() if k!='cpf_name_check'}:
            protected_errors.append(row['id'])
    elif row != old:
        unexpected_changes.append(row['id'])
prev = 'GENESIS'
for row in data['audit']:
    raw = '|'.join([prev,row['ts'],row['event'],str(row['signature_id']) if row['signature_id'] is not None else '',row['data']])
    if row['prev_hash'] != prev or hashlib.sha256(raw.encode()).hexdigest() != row['hash']:
        raise RuntimeError('Audit chain mismatch')
    prev = row['hash']
result = {'protected_field_errors':len(protected_errors), 'other_rows_changed_since_snapshot':len(unexpected_changes),
          'audit_chain_valid':True,'audit_entries':len(data['audit']), 'updated_records':len(changed),
          'updated_ids_missing':len(changed-{r['id'] for r in data['signatures']})}
Path(output).write_text(json.dumps(result,indent=2))
Path(output).chmod(0o600)
print(json.dumps(result))
if protected_errors or result['updated_ids_missing']:
    raise SystemExit(1)
