"""Shared per-node slot gate; no DB creation, queue, daemon or host action.

Both candidate dispatchers must invoke check on their SAME open transaction.
No review provider is installed by this packet; the default is fail-closed.
An eventual private provider must verify the reviewed paired installation, not
take a public caller's boolean as proof. It is not a new approval channel.
"""
import hashlib
import json
from pathlib import Path
import re

TABLE = 'canonical_consumer_slots'
WORKERS = frozenset({'civo', 'akamai', 'azure'})
TERMINAL = frozenset({'completed', 'failed', 'canceled'})
COLUMNS = frozenset({'job_id','generation','manifest_sha256','worker_id','backend','state','active',
                     'start_intent','finish_intent','retire_intent','custody_json','custody_sha256','ack_json','created_at','updated_at'})


class GuardPending(RuntimeError):
    pass


def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(',',':'),allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def job_worker(row, local_node='civo'):
    value=json.loads(row['payload'])
    if value.get('backend')=='ssh-systemd-v1':
        worker=value.get('worker_id')
        if worker not in WORKERS:raise GuardPending('unknown_remote_node')
        return worker
    # This candidate's legacy launcher executes on Civo only. No unverified
    # portable native profile or legacy worker assignment is inferred.
    return local_node


class PairedGuard:
    def __init__(self, review_provider=None):
        self.review_provider=review_provider

    def check(self, db, worker):
        if type(worker) is not str or worker not in WORKERS or not db.in_transaction:
            raise GuardPending('same_transaction_and_fixed_worker_required')
        if self.review_provider is None:
            raise GuardPending('paired_guard_review_and_installation_pending')
        proof=self.review_provider(worker)
        keys={'worker_id','reviewed','legacy_guard_enabled','consumer_guard_enabled','paired_revision_sha256','queue_path'}
        if (type(proof) is not dict or set(proof)!=keys or proof['worker_id']!=worker or proof['reviewed'] is not True
                or proof['legacy_guard_enabled'] is not True or proof['consumer_guard_enabled'] is not True
                or type(proof['paired_revision_sha256']) is not str or not re.fullmatch('[a-f0-9]{64}',proof['paired_revision_sha256'])
                or proof['paired_revision_sha256']=='0'*64):
            raise GuardPending('actual_paired_guard_evidence_required')
        paths=[row[2] for row in db.execute('PRAGMA database_list') if row[1]=='main']
        if len(paths)!=1 or not paths[0] or Path(proof['queue_path']).absolute()!=Path(paths[0]).absolute():
            raise GuardPending('same_canonical_queue_evidence_required')
        columns={row[1] for row in db.execute(f'PRAGMA table_info({TABLE})')}
        if columns!=COLUMNS:
            raise GuardPending('explicit_reviewed_slot_schema_required')
        row=db.execute("SELECT sql,tbl_name FROM sqlite_master WHERE type='index' AND name='canonical_consumer_one_slot'").fetchone()
        attached=[item for item in db.execute(f'PRAGMA index_list({TABLE})') if item[1]=='canonical_consumer_one_slot']
        names=[v[2] for v in db.execute('PRAGMA index_info(canonical_consumer_one_slot)')]
        sql=re.sub(r'\s+','',row[0].lower()) if row else ''
        if (not row or row[1]!=TABLE or len(attached)!=1 or attached[0][2]!=1 or attached[0][4]!=1
                or names!=['worker_id'] or 'createuniqueindex' not in sql or not sql.endswith('whereactive=1')):
            raise GuardPending('unique_active_slot_per_node_required')

    def reserve_legacy(self, db, row, worker, generation, now):
        self.check(db,worker)
        if (worker!='civo' or type(row['id']) is not str or not re.fullmatch('[a-f0-9]{32}',row['id'])
                or type(generation) is not int or generation<1 or row['generation']!=generation or row['state']!='queued'):
            raise GuardPending('exact_local_queued_generation_required')
        payload=json.loads(row['payload'])
        if (payload.get('backend') not in {None,'legacy-local'} or payload.get('worker_id',worker)!=worker
                or hashlib.sha256(canonical(payload).encode()).hexdigest()!=row['digest']):
            raise GuardPending('legacy_payload_identity_required')
        if db.execute(f'SELECT 1 FROM {TABLE} WHERE job_id=? OR (worker_id=? AND active=1)',(row['id'],worker)).fetchone():
            raise GuardPending('existing_node_slot_no_replay')
        identity={'job_id':row['id'],'generation':generation,'worker_id':worker,'backend':'legacy-local','payload_sha256':row['digest']}
        db.execute(f'''INSERT INTO {TABLE}(job_id,generation,manifest_sha256,worker_id,backend,state,active,start_intent,created_at,updated_at)
                       VALUES(?,?,?,?,?,'legacy_starting',1,?,?,?)''',
                   (row['id'],generation,digest(identity),worker,'legacy-local',now,now,now))
        return identity

    def release_legacy(self, db, row, worker, proof, now):
        self.check(db,worker)
        slot=db.execute(f'SELECT * FROM {TABLE} WHERE job_id=?',(row['id'],)).fetchone()
        identity={'job_id':row['id'],'generation':row['generation'],'worker_id':worker,'backend':'legacy-local','payload_sha256':row['digest']}
        if (slot is None or slot['worker_id']!=worker or slot['backend']!='legacy-local' or slot['generation']!=row['generation']
                or slot['manifest_sha256']!=digest(identity) or row['state'] not in TERMINAL):
            raise GuardPending('bound_terminal_legacy_slot_required')
        expected={**identity,'state':row['state'],'unit_stopped':True,'cgroup_empty':True,
                  'processes_drained':True,'artifact_custody_verified':True}
        fields=set(expected)|{'result_sha256','custody_receipt_sha256','state_receipt_sha256'}
        if type(proof) is not dict or set(proof)!=fields or any(type(proof[k]) is not type(v) or proof[k]!=v for k,v in expected.items()):
            raise GuardPending('complete_legacy_terminal_custody_proof_required')
        for key in fields-set(expected):
            if type(proof[key]) is not str or not re.fullmatch('[a-f0-9]{64}',proof[key]) or proof[key]=='0'*64:
                raise GuardPending('durable_legacy_custody_receipt_required')
        if not slot['active']:
            if slot['ack_json']!=canonical(proof):raise GuardPending('conflicting_legacy_release')
            return {'released':True,'changed':False}
        # The trusted private provider has validated actual process/cgroup and
        # fsynced result/artifact files. No public caller may submit this proof.
        db.execute(f"UPDATE {TABLE} SET active=0,state='legacy_retired',custody_json=?,custody_sha256=?,ack_json=?,updated_at=? WHERE job_id=?",
                   (canonical(proof),proof['custody_receipt_sha256'],canonical(proof),now,row['id']))
        return {'released':True,'changed':True}
