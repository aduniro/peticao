#!/usr/bin/env python3
"""Guarded, audited CPF marker update. Dry-run rolls its transaction back."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess


def sql_for(plan, run, digest, commit=False, allow_particles=False):
    encoded = json.dumps(plan, ensure_ascii=False, separators=(',', ':'))
    evidence = json.dumps({'run': run, 'plan_sha256': digest,
        'source': 'cpf-brasil.org; cached lookup; exact or normalized full name',
        'verifications': [{'id': r['expected']['id'], 'lookup_at': r['lookup_at'],
                           'comparison': r['comparison'],
                           'previous': r['expected'].get('cpf_name_check')}
                          for r in plan]}, separators=(',', ':'))
    quote = lambda x: "'" + x.replace("'", "''") + "'"
    accepted = "'coincidencia_exata','coincidencia_normalizada'" + (",'variacao_de_particulas'" if allow_particles else "")
    return f"""
BEGIN;
SET LOCAL statement_timeout='120s';
SET LOCAL lock_timeout='5s';
SET LOCAL standard_conforming_strings=on;
CREATE TEMP TABLE cpf_plan ON COMMIT DROP AS
 SELECT expected,lookup_at,comparison FROM jsonb_to_recordset({quote(encoded)}::jsonb)
 AS x(expected jsonb, lookup_at text, comparison text);
DO $guard$ BEGIN
 IF EXISTS(SELECT 1 FROM cpf_plan WHERE comparison NOT IN ({accepted})
    OR expected->>'category' NOT IN ('servidor','apoiador')
    OR expected->>'status' NOT IN ('pending','confirmed')
    OR expected->>'cpf_hash' IS NULL
    OR expected->>'cpf_name_check'='match')
 OR (SELECT count(*) FROM cpf_plan)<>(SELECT count(DISTINCT expected->>'id') FROM cpf_plan)
 THEN RAISE EXCEPTION 'Invalid consolidation plan'; END IF;
END $guard$;
CREATE TEMP TABLE cpf_changed ON COMMIT DROP AS
 WITH changed AS (
  UPDATE signatures s SET cpf_name_check='match'
  FROM cpf_plan p WHERE s.id=(p.expected->>'id')::int AND to_jsonb(s)=p.expected
  RETURNING s.id
 ) SELECT id FROM changed;
DO $preserve$ BEGIN
 IF EXISTS(SELECT 1 FROM signatures s JOIN cpf_changed c ON c.id=s.id
     JOIN cpf_plan p ON (p.expected->>'id')::int=s.id
     WHERE to_jsonb(s)-'cpf_name_check' <> p.expected-'cpf_name_check'
       OR s.cpf_name_check IS DISTINCT FROM 'match')
 THEN RAISE EXCEPTION 'Protected fields changed'; END IF;
END $preserve$;
SELECT pg_advisory_xact_lock(7001);
INSERT INTO audit_log(ts,event,signature_id,data,prev_hash,hash)
SELECT t.ts,'cpf_verifications_consolidated',NULL,d.data,prev.hash,
 encode(sha256(convert_to(prev.hash||'|'||t.ts||'|cpf_verifications_consolidated||'||d.data,'UTF8')),'hex')
FROM (SELECT to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ts) t,
 (SELECT coalesce((SELECT hash FROM audit_log ORDER BY id DESC LIMIT 1),'GENESIS') hash) prev,
 (SELECT ({quote(evidence)}::jsonb || jsonb_build_object(
   'updated_ids',(SELECT coalesce(json_agg(id ORDER BY id),'[]') FROM cpf_changed)))::text data) d
WHERE EXISTS(SELECT 1 FROM cpf_changed);
SELECT json_build_object('mode',{'true' if commit else 'false'},'proposed',(SELECT count(*) FROM cpf_plan),
 'updated',(SELECT count(*) FROM cpf_changed),
 'updated_ids',(SELECT coalesce(json_agg(id ORDER BY id),'[]') FROM cpf_changed),
 'stale_ids',(SELECT coalesce(json_agg((expected->>'id')::int),'[]') FROM cpf_plan
  WHERE (expected->>'id')::int NOT IN (SELECT id FROM cpf_changed)),
 'protected_fields_unchanged',true);
{'COMMIT' if commit else 'ROLLBACK'};
"""


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--database', required=True)
    parser.add_argument('--plan', type=Path, required=True)
    parser.add_argument('--run', required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--commit', action='store_true')
    parser.add_argument('--allow-particles', action='store_true', help='Use only after explicit approval of particle variations')
    args = parser.parse_args()
    if args.database != 'peticao' and not re.fullmatch(r'cpf_audit_[0-9_]+', args.database):
        raise RuntimeError('Unexpected database')
    if not re.fullmatch(r'consolidacao-[0-9TZ]+', args.run):
        raise RuntimeError('Unexpected run')
    os.umask(0o077)
    raw = args.plan.read_bytes()
    plan = json.loads(raw)
    if not plan:
        raise RuntimeError('Empty plan')
    sql = sql_for(plan, args.run, hashlib.sha256(raw).hexdigest(), args.commit, args.allow_particles)
    proc = subprocess.run(['/usr/sbin/runuser','-u','postgres','--','/usr/bin/psql',
        '-X','-qAt','-v','ON_ERROR_STOP=1','-d',args.database], input=sql,
        text=True, capture_output=True, timeout=135)
    if proc.returncode:
        raise RuntimeError('Transaction failed and rolled back; private details omitted')
    result = json.loads(next(line for line in proc.stdout.splitlines() if line.startswith('{')))
    with args.output.open('x') as f:
        json.dump(result,f,indent=2)
    args.output.chmod(0o600)
    print(json.dumps({k:v for k,v in result.items() if not k.endswith('_ids')}))


if __name__ == '__main__':
    main()
