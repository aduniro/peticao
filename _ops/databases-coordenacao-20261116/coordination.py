"""Compact, isolated coordination store; never an authority for live effects."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import secrets
import sqlite3
import sys
import uuid
import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb


def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':'))


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def refs(value):
    if not isinstance(value, list) or len(value) > 32:
        raise ValueError('invalid_refs')
    for ref in value:
        if not isinstance(ref, str) or not 1 <= len(ref) <= 512 or '\n' in ref:
            raise ValueError('invalid_ref')
        if '://' in ref and ('@' in ref or '?' in ref):
            raise ValueError('use_redacted_reference')
    return value


class Store:
    def __init__(self, config, namespace='validation'):
        self.config = Path(config).expanduser()
        if self.config.is_symlink() or self.config.stat().st_mode & 0o077:
            raise PermissionError('config_requires_0600')
        self.settings = json.loads(self.config.read_text())
        if self.settings.get('mode') != 'isolated':
            raise PermissionError('live_cutover_not_enabled')
        if not namespace or len(namespace) > 80:
            raise ValueError('invalid_namespace')
        self.namespace = namespace

    def connect(self, direct=False):
        db=psycopg.connect(self.settings['direct_uri' if direct else 'pooled_uri'],
                          connect_timeout=15,row_factory=dict_row,
                          application_name='peticao-coordination-isolated',
                          sslmode='verify-full',sslrootcert='/etc/ssl/certs/ca-certificates.crt')
        try:
            # PgBouncer rejects timeout GUCs in the startup package. LOCAL settings
            # belong to this transaction and cannot leak to the next pooled client.
            db.execute("SET LOCAL statement_timeout='15s'")
            db.execute("SET LOCAL lock_timeout='5s'")
            return db
        except Exception:
            db.close();raise

    def migrate(self):
        applied=[]
        with self.connect(direct=True) as db:
            db.execute('SELECT pg_advisory_xact_lock(71201116)')
            for version,name in [(1,'schema.sql'),(2,'schema002.sql')]:
                sql=Path(__file__).with_name(name).read_text()
                checksum=hashlib.sha256(sql.encode()).hexdigest()
                if version==1:db.execute(sql)
                prior=db.execute('SELECT sha256 FROM peticao_coord.migrations WHERE version=%s',(version,)).fetchone()
                if prior and prior['sha256']!=checksum:raise ValueError('migration_checksum_mismatch')
                if not prior:
                    if version!=1:db.execute(sql)
                    db.execute('INSERT INTO peticao_coord.migrations(version,sha256) VALUES(%s,%s)',(version,checksum))
                applied.append({'version':version,'sha256':checksum})
        return {'migrations':applied,'mode':'isolated'}

    def event(self, db, actor, kind, task=None, evidence=None, fence=None):
        db.execute('INSERT INTO peticao_coord.events(namespace,task_id,actor,kind,refs,fence) VALUES(%s,%s,%s,%s,%s,%s)',
                   (self.namespace, task, actor, kind, Jsonb(refs(evidence or [])), fence))

    def register_agent(self, agent, thread_id, role, context=None):
        # This is a directory entry, not a ledger voter or execution permission.
        with self.connect() as db:
            db.execute('''INSERT INTO peticao_coord.agents(id,thread_id,role,context_refs) VALUES(%s,%s,%s,%s)
              ON CONFLICT(id) DO UPDATE SET thread_id=excluded.thread_id,role=excluded.role,
                context_refs=excluded.context_refs,updated_at=now()''', (agent,thread_id,role,Jsonb(refs(context or []))))
        return {'id':agent,'voting_member':False}

    def create(self, key, title, priority=50, assigned_to=None, context=None, depends_on=None, actor='coordinator'):
        context = refs(context or [])
        depends_on = sorted(set(str(uuid.UUID(x)) for x in (depends_on or [])))
        if not isinstance(key, str) or not 1 <= len(key) <= 160:
            raise ValueError('invalid_idempotency_key')
        payload = dict(title=title, priority=priority, assigned_to=assigned_to, context=context, depends_on=depends_on)
        sha = digest(payload)
        with self.connect() as db:
            row = db.execute('''INSERT INTO peticao_coord.tasks(id,namespace,idem_key,input_sha256,title,priority,assigned_to,context_refs)
              VALUES(%s,%s,%s,%s,%s,%s,%s,%s) ON CONFLICT(namespace,idem_key) DO NOTHING RETURNING id''',
              (uuid.uuid4(), self.namespace, key, sha, title, priority, assigned_to, Jsonb(context))).fetchone()
            if not row:
                old = db.execute('SELECT id,input_sha256 FROM peticao_coord.tasks WHERE namespace=%s AND idem_key=%s', (self.namespace,key)).fetchone()
                if old['input_sha256'] != sha:
                    raise ValueError('idempotency_conflict')
                return {'id': str(old['id']), 'replayed': True}
            tid = row['id']
            for dep in depends_on:
                if not db.execute('SELECT id FROM peticao_coord.tasks WHERE id=%s AND namespace=%s', (dep,self.namespace)).fetchone():
                    raise ValueError('dependency_missing_or_other_namespace')
                db.execute('INSERT INTO peticao_coord.dependencies VALUES(%s,%s)', (tid,dep))
            self.event(db,actor,'created',tid)
            return {'id': str(tid), 'replayed': False}

    def list(self, agent=None, statuses=None, limit=20, after=None, min_priority=0, ready_only=False):
        if not 1 <= limit <= 100:
            raise ValueError('limit_1_to_100')
        statuses = statuses or ['pending','running','uncertain','failed']
        with self.connect() as db:
            rows = db.execute('''SELECT t.id,t.title,t.priority,t.assigned_to,t.status,t.version,
              NOT EXISTS(SELECT 1 FROM peticao_coord.dependencies d JOIN peticao_coord.tasks p ON p.id=d.depends_on
                WHERE d.task_id=t.id AND p.status<>'completed') AS ready
              FROM peticao_coord.tasks t WHERE namespace=%s AND status=ANY(%s)
              AND (%s::text IS NULL OR assigned_to=%s) AND priority >= %s
              AND (%s::uuid IS NULL OR id>%s::uuid)
              AND (NOT %s OR NOT EXISTS(SELECT 1 FROM peticao_coord.dependencies d JOIN peticao_coord.tasks p
                ON p.id=d.depends_on WHERE d.task_id=t.id AND p.status<>'completed')) ORDER BY id LIMIT %s''',
              (self.namespace,statuses,agent,agent,min_priority,after,after,ready_only,limit+1)).fetchall()
        return {'items':rows[:limit], 'next':str(rows[limit-1]['id']) if len(rows)>limit else None, 'mode':'isolated'}

    def context(self, task):
        with self.connect() as db:
            row=db.execute('SELECT id,title,status,version,context_refs,evidence_refs FROM peticao_coord.tasks WHERE id=%s AND namespace=%s', (task,self.namespace)).fetchone()
            if row is None: raise ValueError('task_not_found')
            return row

    def update(self, task, expected_version, title, priority, assigned_to, actor='coordinator'):
        with self.connect() as db:
            row=db.execute('''UPDATE peticao_coord.tasks SET title=%s,priority=%s,assigned_to=%s,version=version+1,updated_at=now()
              WHERE id=%s AND namespace=%s AND version=%s AND status='pending' RETURNING id,version''',
              (title,priority,assigned_to,task,self.namespace,expected_version)).fetchone()
            if row is None: raise ValueError('version_or_state_conflict')
            self.event(db,actor,'updated',task)
            return row

    def claim(self, agent, ttl=120):
        if not 30 <= ttl <= 3600: raise ValueError('ttl_30_to_3600')
        token=secrets.token_urlsafe(32)
        with self.connect() as db:
            row=db.execute('''SELECT t.id FROM peticao_coord.tasks t WHERE namespace=%s AND status='pending'
              AND (assigned_to IS NULL OR assigned_to=%s)
              AND NOT EXISTS(SELECT 1 FROM peticao_coord.dependencies d JOIN peticao_coord.tasks p ON p.id=d.depends_on
                WHERE d.task_id=t.id AND p.status<>'completed')
              ORDER BY priority DESC,created_at,id FOR UPDATE SKIP LOCKED LIMIT 1''', (self.namespace,agent)).fetchone()
            if row is None:return None
            result=db.execute('''UPDATE peticao_coord.tasks SET status='running',owner=%s,token_hash=%s,
              fence=nextval('peticao_coord.fences'),expires_at=clock_timestamp()+%s*interval '1 second',version=version+1,updated_at=now()
              WHERE id=%s RETURNING id,fence,expires_at''', (agent,digest(token),ttl,row['id'])).fetchone()
            self.event(db,agent,'claimed',row['id'],fence=result['fence'])
            result['token']=token  # caller must save to a private file, never logs
            return result

    def complete(self, task, agent, token, fence, evidence):
        if not evidence: raise ValueError('evidence_required')
        evidence=refs(evidence)
        with self.connect() as db:
            db.execute('SELECT id FROM peticao_coord.tasks WHERE id=%s AND namespace=%s FOR UPDATE',(task,self.namespace))
            row=db.execute('''UPDATE peticao_coord.tasks SET status='completed',evidence_refs=%s,
              token_hash=NULL,version=version+1,updated_at=now() WHERE id=%s AND namespace=%s AND status='running'
              AND owner=%s AND token_hash=%s AND fence=%s AND expires_at>clock_timestamp() RETURNING id,version''',
              (Jsonb(evidence),task,self.namespace,agent,digest(token),fence)).fetchone()
            if row is None:raise PermissionError('stale_or_wrong_lease')
            self.event(db,agent,'completed',task,evidence,fence)
            return row

    def expire(self):
        with self.connect() as db:
            rows=db.execute('''UPDATE peticao_coord.tasks SET status='uncertain',version=version+1,updated_at=now()
              WHERE namespace=%s AND status='running' AND expires_at<=clock_timestamp() RETURNING id,fence,owner''', (self.namespace,)).fetchall()
            for r in rows:self.event(db,'coordinator','expired_uncertain',r['id'],fence=r['fence'])
            return rows

    def reconcile(self, task, fence, result, evidence, actor='coordinator'):
        if result not in ['pending','completed','failed'] or not evidence:raise ValueError('reconciliation_evidence_required')
        evidence=refs(evidence)
        with self.connect() as db:
            row=db.execute('''UPDATE peticao_coord.tasks SET status=%s,evidence_refs=%s,owner=NULL,token_hash=NULL,
              expires_at=NULL,version=version+1,updated_at=now() WHERE id=%s AND namespace=%s AND status='uncertain'
              AND fence=%s RETURNING id,version''', (result,Jsonb(evidence),task,self.namespace,fence)).fetchone()
            if row is None:raise PermissionError('not_uncertain_or_fence_mismatch')
            self.event(db,actor,'reconciled_'+result,task,evidence,fence)
            return row

    def decision(self, question, choice, evidence, actor='coordinator'):
        evidence=refs(evidence)
        with self.connect() as db:
            row=db.execute('''INSERT INTO peticao_coord.decisions VALUES(%s,%s,%s,%s,%s,%s,now()) RETURNING id''',
                           (uuid.uuid4(),self.namespace,actor,question,choice,Jsonb(evidence))).fetchone()
            self.event(db,actor,'decision',evidence=evidence)
            return row

    def events(self, after=0, limit=20):
        if not 1<=limit<=100:raise ValueError('limit_1_to_100')
        with self.connect() as db:
            return db.execute('''SELECT seq,task_id,actor,kind,refs,fence,at FROM peticao_coord.events
              WHERE namespace=%s AND seq>%s ORDER BY seq LIMIT %s''', (self.namespace,after,limit)).fetchall()

    def progress(self,task,actor,evidence):
        evidence=refs(evidence)
        if not evidence:raise ValueError('progress_evidence_required')
        with self.connect() as db:
            row=db.execute('SELECT evidence_refs,status FROM peticao_coord.tasks WHERE id=%s AND namespace=%s FOR UPDATE',
                           (task,self.namespace)).fetchone()
            if row is None:raise ValueError('task_not_found')
            combined=refs(list(dict.fromkeys(row['evidence_refs']+evidence)))
            result=db.execute('UPDATE peticao_coord.tasks SET evidence_refs=%s,version=version+1,updated_at=now() WHERE id=%s RETURNING id,status,version',
                              (Jsonb(combined),task)).fetchone()
            self.event(db,actor,'progress',task,evidence)
            return result

    def external_jobs(self,source_id='santiago-admin',limit=20,after=''):
        if not 1<=limit<=100:raise ValueError('limit_1_to_100')
        with self.connect() as db:
            rows=db.execute('''SELECT external_id,state,source_generation,p.watermark FROM peticao_coord.queue_projection p
              WHERE p.source_id=%s AND external_id>%s AND p.watermark=(SELECT MAX(watermark)
                FROM peticao_coord.queue_snapshots s WHERE s.source_id=p.source_id)
              ORDER BY external_id LIMIT %s''',(source_id,after,limit+1)).fetchall()
        return {'items':rows[:limit],'next':rows[limit-1]['external_id'] if len(rows)>limit else None,
                'authority':'santiago_only','snapshot_projection':True}

    def live_dispatch(self, *args, **kwargs):
        raise PermissionError('authority_remains_existing_ledger_and_queue')


def ledger_snapshot(source):
    """Read an internally consistent metadata projection, never tokens or event payloads."""
    uri=Path(source).resolve().as_uri()+'?mode=ro'
    with sqlite3.connect(uri,uri=True) as db:
        db.execute('BEGIN')
        watermark=db.execute('SELECT COALESCE(MAX(seq),0) FROM events').fetchone()[0]
        summary={'watermark':watermark,'actors':db.execute('SELECT COUNT(*) FROM actors').fetchone()[0],
                 'events':db.execute('SELECT COUNT(*) FROM events').fetchone()[0],
                 'lease_states':dict(db.execute('SELECT state,COUNT(*) FROM leases GROUP BY state'))}
        data={'source_id':'cooperative-ledger-dell','watermark':watermark,'summary':summary}
        return dict(data,sha256=digest(data))


def import_snapshot(store, snapshot):
    if set(snapshot)!={'source_id','watermark','summary','sha256'}:raise ValueError('invalid_snapshot_fields')
    data={k:v for k,v in snapshot.items() if k!='sha256'};summary=snapshot['summary']
    if not isinstance(snapshot['source_id'],str) or not snapshot['source_id'] or len(snapshot['source_id'])>160:raise ValueError('invalid_source_id')
    if type(snapshot['watermark']) is not int or snapshot['watermark']<0:raise ValueError('invalid_watermark')
    if not isinstance(summary,dict) or set(summary)!={'watermark','actors','events','lease_states'}:raise ValueError('invalid_ledger_summary')
    if summary['watermark']!=snapshot['watermark']:raise ValueError('watermark_mismatch')
    if any(type(summary[k]) is not int or summary[k]<0 for k in ['watermark','actors','events']):raise ValueError('invalid_ledger_counts')
    if not isinstance(summary['lease_states'],dict) or any(not isinstance(k,str) or type(v) is not int or v<0 for k,v in summary['lease_states'].items()):raise ValueError('invalid_lease_states')
    if snapshot['sha256']!=digest(data):raise ValueError('snapshot_checksum')
    with store.connect() as db:
        db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',('ledger:'+snapshot['source_id'],))
        latest=db.execute('SELECT watermark,sha256 FROM peticao_coord.ledger_snapshots WHERE source_id=%s ORDER BY watermark DESC LIMIT 1',
                          (snapshot['source_id'],)).fetchone()
        if latest and latest['watermark']>snapshot['watermark']:raise ValueError('stale_snapshot')
        inserted=db.execute('''INSERT INTO peticao_coord.ledger_snapshots(source_id,watermark,sha256,summary)
          VALUES(%s,%s,%s,%s) ON CONFLICT DO NOTHING RETURNING sha256''',
          (snapshot['source_id'],snapshot['watermark'],snapshot['sha256'],Jsonb(summary))).fetchone()
        if not inserted:
            old=db.execute('SELECT sha256 FROM peticao_coord.ledger_snapshots WHERE source_id=%s AND watermark=%s',
                           (snapshot['source_id'],snapshot['watermark'])).fetchone()
            if old['sha256']!=snapshot['sha256']:raise ValueError('source_watermark_conflict')
    return {'watermark':snapshot['watermark'],'replayed':not bool(inserted),'authority':'existing_ledger_only'}


def queue_snapshot(source, source_id='santiago-admin'):
    # Exact observed admin queue schema. No payloads, errors, recipient fields, nonces or authority secrets.
    with sqlite3.connect(Path(source).resolve().as_uri()+'?mode=ro',uri=True) as db:
        db.row_factory=sqlite3.Row;db.execute('PRAGMA query_only=ON');db.execute('BEGIN')
        watermark=db.execute('SELECT COALESCE(MAX(seq),0) FROM events').fetchone()[0]
        count=db.execute('SELECT COUNT(*) FROM jobs').fetchone()[0]
        if count>10000:raise ValueError('queue_snapshot_requires_pagination_above_10000')
        jobs=[dict(r) for r in db.execute('SELECT id,state,generation,digest,created_at,updated_at FROM jobs ORDER BY id')]
        result={'source_id':source_id,'watermark':watermark,'jobs':jobs}
        result['sha256']=digest(result)
        return result


def import_queue(store, snapshot):
    expected={'source_id','watermark','jobs','sha256'}
    if set(snapshot)!=expected:raise ValueError('invalid_snapshot_fields')
    data={k:v for k,v in snapshot.items() if k!='sha256'}
    if digest(data)!=snapshot['sha256']:raise ValueError('snapshot_checksum')
    with store.connect() as db:
        db.execute('SELECT pg_advisory_xact_lock(hashtext(%s))',(snapshot['source_id'],))
        latest=db.execute('SELECT watermark,sha256 FROM peticao_coord.queue_snapshots WHERE source_id=%s ORDER BY watermark DESC LIMIT 1',
                          (snapshot['source_id'],)).fetchone()
        if latest:
            if snapshot['watermark']<latest['watermark']:raise ValueError('stale_snapshot')
            if snapshot['watermark']==latest['watermark']:
                if snapshot['sha256']!=latest['sha256']:raise ValueError('source_watermark_conflict')
                return {'replayed':True,'watermark':snapshot['watermark'],'count':len(snapshot['jobs']),'authority':'santiago_only'}
        for row in snapshot['jobs']:
            if set(row)!={'id','state','generation','digest','created_at','updated_at'}:raise ValueError('private_fields_refused')
            db.execute('''INSERT INTO peticao_coord.queue_projection VALUES(%s,%s,%s,%s,%s,%s,%s,%s)
              ON CONFLICT(source_id,external_id) DO UPDATE SET state=excluded.state,source_generation=excluded.source_generation,
                payload_digest=excluded.payload_digest,source_created_at=excluded.source_created_at,
                source_updated_at=excluded.source_updated_at,watermark=excluded.watermark''',
              (snapshot['source_id'],row['id'],row['state'],row['generation'],row['digest'],row['created_at'],row['updated_at'],snapshot['watermark']))
        db.execute('INSERT INTO peticao_coord.queue_snapshots(source_id,watermark,sha256,metadata) VALUES(%s,%s,%s,%s)',
                   (snapshot['source_id'],snapshot['watermark'],snapshot['sha256'],Jsonb({'count':len(snapshot['jobs']),'scope':'metadata_only'})))
    return {'replayed':False,'watermark':snapshot['watermark'],'count':len(snapshot['jobs']),'authority':'santiago_only'}


class Outbox:
    """Durable create intents only. Offline is never an execution authority."""
    APPLICATION_ID=0x50435451

    def __init__(self, path, namespace='validation', allowed_root=None):
        root=Path(allowed_root or Path.home()/'.local/state/peticao/databases/outbox').expanduser()
        self.namespace=namespace
        self.path=Path(path).expanduser()
        if not self.path.is_absolute():self.path=root/self.path
        if self.path.is_symlink():raise PermissionError('symlink_outbox')
        if not self.path.resolve().is_relative_to(root.resolve()):raise PermissionError('outbox_outside_dedicated_root')
        root.mkdir(mode=0o700,parents=True,exist_ok=True)
        if root.stat().st_mode & 0o077:raise PermissionError('private_outbox_root_required')
        self.path.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        if self.path.parent.stat().st_mode & 0o077:raise PermissionError('private_outbox_directory_required')
        try:fd=os.open(self.path,os.O_RDWR|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        except FileExistsError:fd=None
        if self.path.stat().st_mode & 0o077:raise PermissionError('private_outbox_required')
        if fd is not None:
            os.close(fd)
            with sqlite3.connect(self.path) as db:
                db.execute(f'PRAGMA application_id={self.APPLICATION_ID}');db.execute('PRAGMA user_version=2')
                db.execute('''CREATE TABLE intents(namespace TEXT NOT NULL,key TEXT NOT NULL,payload TEXT NOT NULL,
                  sha256 TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'pending',task_id TEXT,last_error TEXT,PRIMARY KEY(namespace,key))''')
        else:
            # The first opening of an existing file is strictly RO, before CREATE/PRAGMA writes.
            with sqlite3.connect(self.path.resolve().as_uri()+'?mode=ro',uri=True) as db:
                if db.execute('PRAGMA application_id').fetchone()[0]!=self.APPLICATION_ID or db.execute('PRAGMA user_version').fetchone()[0]!=2:
                    raise PermissionError('unrecognized_outbox_database')
                if [r[1] for r in db.execute('PRAGMA table_info(intents)')]!=['namespace','key','payload','sha256','state','task_id','last_error']:
                    raise PermissionError('unrecognized_outbox_schema')

    def enqueue(self, key, payload):
        allowed={'title','priority','assigned_to','context','depends_on','actor'}
        if set(payload)-allowed:raise ValueError('invalid_intent_fields')
        refs(payload.get('context',[]))
        sha=digest(payload)
        with sqlite3.connect(self.path) as db:
            db.execute('BEGIN IMMEDIATE')
            inserted=db.execute('INSERT OR IGNORE INTO intents(namespace,key,payload,sha256) VALUES(?,?,?,?)',(self.namespace,key,canonical(payload),sha)).rowcount
            stored=db.execute('SELECT sha256 FROM intents WHERE namespace=? AND key=?',(self.namespace,key)).fetchone()[0]
            if stored!=sha:raise ValueError('outbox_idempotency_conflict')
        return {'key':key,'state':'intent_only','replayed':not bool(inserted)}

    def flush(self, store, limit=20):
        if not 1<=limit<=100:raise ValueError('limit_1_to_100')
        if getattr(store,'namespace',None)!=self.namespace:raise ValueError('outbox_namespace_mismatch')
        done=0
        with sqlite3.connect(self.path) as db:
            rows=db.execute("SELECT key,payload,sha256 FROM intents WHERE namespace=? AND state='pending' ORDER BY key LIMIT ?",(self.namespace,limit)).fetchall()
            for key,raw,sha in rows:
                if digest(json.loads(raw))!=sha:raise ValueError('outbox_payload_checksum')
                try:
                    result=store.create(key,**json.loads(raw))
                except psycopg.OperationalError as e:
                    db.execute('UPDATE intents SET last_error=? WHERE namespace=? AND key=?',(type(e).__name__,self.namespace,key))
                    break  # no busy retry, no lease or dispatch while offline
                db.execute("UPDATE intents SET state='delivered',task_id=?,last_error=NULL WHERE namespace=? AND key=?",(result['id'],self.namespace,key))
                done+=1
        return {'delivered':done,'pending':len(rows)-done,'authority':'none_intents_only'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--config',default=str(Path.home()/'.config/peticao/databases/config.json'))
    p.add_argument('--namespace',default='validation')
    sub=p.add_subparsers(dest='command',required=True)
    sub.add_parser('migrate')
    c=sub.add_parser('list');c.add_argument('--agent');c.add_argument('--status',action='append');c.add_argument('--limit',type=int,default=20);c.add_argument('--after');c.add_argument('--min-priority',type=int,default=0);c.add_argument('--ready-only',action='store_true')
    c=sub.add_parser('create');c.add_argument('--key',required=True);c.add_argument('--title',required=True);c.add_argument('--priority',type=int,default=50);c.add_argument('--agent');c.add_argument('--ref',action='append',default=[]);c.add_argument('--depends-on',action='append',default=[])
    c=sub.add_parser('context');c.add_argument('task')
    c=sub.add_parser('progress');c.add_argument('task');c.add_argument('--actor',required=True);c.add_argument('--ref',action='append',required=True)
    c=sub.add_parser('events');c.add_argument('--after',type=int,default=0);c.add_argument('--limit',type=int,default=20)
    c=sub.add_parser('external-jobs');c.add_argument('--source-id',default='santiago-admin');c.add_argument('--limit',type=int,default=20);c.add_argument('--after',default='')
    c=sub.add_parser('update');c.add_argument('task');c.add_argument('--version',type=int,required=True);c.add_argument('--title',required=True);c.add_argument('--priority',type=int,required=True);c.add_argument('--agent')
    sub.add_parser('expire')
    c=sub.add_parser('reconcile');c.add_argument('task');c.add_argument('--fence',type=int,required=True);c.add_argument('--result',choices=['pending','completed','failed'],required=True);c.add_argument('--ref',action='append',required=True)
    c=sub.add_parser('decision');c.add_argument('--question',required=True);c.add_argument('--choice',required=True);c.add_argument('--ref',action='append',required=True)
    c=sub.add_parser('outbox-enqueue');c.add_argument('--outbox',type=Path,required=True);c.add_argument('--key',required=True);c.add_argument('--title',required=True)
    c=sub.add_parser('outbox-flush');c.add_argument('--outbox',type=Path,required=True);c.add_argument('--limit',type=int,default=20)
    c=sub.add_parser('claim');c.add_argument('--agent',required=True);c.add_argument('--ttl',type=int,default=120);c.add_argument('--lease-file',type=Path,required=True)
    c=sub.add_parser('complete');c.add_argument('--lease-file',type=Path,required=True);c.add_argument('--ref',action='append',required=True)
    c=sub.add_parser('snapshot-ledger');c.add_argument('--source',type=Path,required=True)
    a=p.parse_args();s=Store(a.config,a.namespace)
    if a.command=='migrate':out=s.migrate()
    elif a.command=='list':out=s.list(a.agent,a.status,a.limit,a.after,a.min_priority,a.ready_only)
    elif a.command=='create':out=s.create(a.key,a.title,a.priority,a.agent,a.ref,a.depends_on)
    elif a.command=='context':out=s.context(a.task)
    elif a.command=='progress':out=s.progress(a.task,a.actor,a.ref)
    elif a.command=='events':out=s.events(a.after,a.limit)
    elif a.command=='external-jobs':
        out=s.external_jobs(a.source_id,a.limit,a.after)
    elif a.command=='update':out=s.update(a.task,a.version,a.title,a.priority,a.agent)
    elif a.command=='expire':out=s.expire()
    elif a.command=='reconcile':out=s.reconcile(a.task,a.fence,a.result,a.ref)
    elif a.command=='decision':out=s.decision(a.question,a.choice,a.ref)
    elif a.command=='outbox-enqueue':out=Outbox(a.outbox,a.namespace).enqueue(a.key,{'title':a.title})
    elif a.command=='outbox-flush':out=Outbox(a.outbox,a.namespace).flush(s,a.limit)
    elif a.command=='snapshot-ledger':out=import_snapshot(s,ledger_snapshot(a.source))
    elif a.command=='claim':
        a.lease_file.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        if a.lease_file.parent.stat().st_mode & 0o077:raise PermissionError('private_lease_directory_required')
        fd=os.open(a.lease_file,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:
            claim=s.claim(a.agent,a.ttl)
            if claim:
                f.write(json.dumps(dict(claim,agent=a.agent,namespace=a.namespace),default=str));f.flush();os.fsync(f.fileno())
                out={k:v for k,v in claim.items() if k!='token'}
            else:out=None
    else:
        if a.lease_file.is_symlink() or a.lease_file.stat().st_mode & 0o077:raise PermissionError('private_lease_required')
        x=json.loads(a.lease_file.read_text())
        if x['namespace']!=a.namespace:raise ValueError('namespace_mismatch')
        out=s.complete(x['id'],x['agent'],x['token'],x['fence'],a.ref)
    print(json.dumps(out,ensure_ascii=False,separators=(',',':'),default=str))


if __name__=='__main__':
    try:main()
    except (ValueError,PermissionError) as e:
        print(json.dumps({'error':str(e)}));sys.exit(2)
    except psycopg.Error as e:
        # Server diagnostics/DSNs can carry data; expose only class and SQLSTATE.
        print(json.dumps({'error':type(e).__name__,'sqlstate':e.sqlstate}));sys.exit(3)
