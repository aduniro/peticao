"""Durable GERAL parent/children coordinator; no live transport or lease issuer.

This module is NOT wired into executor.py. A trusted ADMIN planner supplies an
explicit partitioned plan after the Owner-approved request is verified. Registry,
authority, authorizer and bridge are injected administratively, never by mail.
Every administrative registry participant (minimum ADMIN and PAGINA) must have
explicit owned work. The registry is project participants, not OS processes.
Distinct aliases cannot name the same target. Plan effects are globally unique
within this journal; retrying an uncertain effect under another parent is denied.

authority(lease, parent_id) -> {valid:True, coordinator:'ADMIN', fence:int,
                              lease_id:str}; must consult the UNIQUE real ledger.
authorizer(action,payload,proof) -> True; must verify the authenticated parent
request or ADMIN plan against exact IDs/digests. Defaults refuse everything.
adapter.probe(route) -> ready,target_exists,target_id,exclusive,state,provider,model,reason.
adapter.submit(route,child_id,instruction,metadata) -> state,receipt.
adapter.poll(route,receipt) -> state,receipt,summary.
Adapters MUST enforce metadata.fence at the effect boundary. No deploy approval,
pause, safety or permission gate is waived. Status is always read-only; expired
authority cannot install plans, dispatch, poll-and-record, recover or reconcile.
"""
from __future__ import annotations
import contextlib
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import time


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def identifier(value):
    if not isinstance(value, str) or not re.fullmatch(r'[A-Za-z0-9_.:-]{1,128}', value):
        raise ValueError('invalid_identifier')
    return value


def text(value, limit):
    if not isinstance(value, str) or not value.strip() or len(value.encode()) > limit:
        raise ValueError('invalid_bounded_text')
    return value.strip()


class DisabledAdapter:
    def probe(self, route): return {'ready': False, 'reason': 'bridge_unqualified'}
    def submit(self, *args, **kwargs): raise PermissionError('bridge_unqualified')
    def poll(self, *args, **kwargs): raise PermissionError('bridge_unqualified')


class GlobalCoordinator:
    def __init__(self, database, registry, *, authority=None, authorizer=None, adapter=None):
        self.path = Path(database)
        if not self.path.is_absolute() or self.path.is_symlink():
            raise PermissionError('private_absolute_database_required')
        self.path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.registry = json.loads(canonical(registry))
        if not {'ADMIN', 'PAGINA'}.issubset(self.registry) or len(self.registry) > 32:
            raise ValueError('fixed_registry_requires_admin_and_pagina')
        for route, spec in self.registry.items():
            identifier(route)
            if not isinstance(spec, dict) or set(spec) != {'target_id', 'provider', 'model'}:
                raise ValueError('invalid_fixed_registry')
            for value in spec.values(): text(value, 128)
            identifier(spec['target_id'])
        if len({s['target_id'].casefold() for s in self.registry.values()}) != len(self.registry):
            raise ValueError('registry_targets_must_be_distinct')
        self.authority = authority or (lambda lease, parent: {'valid': False})
        self.authorizer = authorizer or (lambda action, payload, proof: False)
        self.adapter = adapter or DisabledAdapter()
        with self.db() as db:
            db.executescript('''
              CREATE TABLE IF NOT EXISTS authority(fence INTEGER NOT NULL);
              INSERT INTO authority SELECT 0 WHERE NOT EXISTS(SELECT 1 FROM authority);
              CREATE TABLE IF NOT EXISTS parents(id TEXT PRIMARY KEY,digest TEXT NOT NULL,
                approved_ref TEXT NOT NULL,plan_hash TEXT,created_at INTEGER NOT NULL);
              CREATE TABLE IF NOT EXISTS children(id TEXT PRIMARY KEY,parent TEXT NOT NULL,
                task_id TEXT NOT NULL,route TEXT NOT NULL,instruction TEXT NOT NULL,
                responsibility TEXT NOT NULL,effect_key TEXT NOT NULL,resources TEXT NOT NULL,
                dependencies TEXT NOT NULL,state TEXT NOT NULL,reason TEXT,receipt TEXT,
                summary TEXT,fence INTEGER NOT NULL,updated_at INTEGER NOT NULL,
                UNIQUE(parent,task_id),UNIQUE(effect_key));
              CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,
                parent TEXT,child TEXT,state TEXT NOT NULL,reason TEXT,at INTEGER NOT NULL);
            ''')
        self.path.chmod(0o600)

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.row_factory = sqlite3.Row
        try:
            with db: yield db
        finally: db.close()

    @contextlib.contextmanager
    def exclusive(self):
        fd = os.open(self.path.with_suffix('.global.lock'), os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            yield
        finally: os.close(fd)

    def permit(self, lease, parent, db):
        proof = self.authority(lease, parent)
        if not isinstance(proof, dict) or proof.get('valid') is not True or proof.get('coordinator') != 'ADMIN' or type(proof.get('fence')) is not int or proof['fence'] < 1:
            raise PermissionError('real_coordinator_authority_required')
        identifier(proof.get('lease_id'))
        current = db.execute('SELECT fence FROM authority').fetchone()[0]
        if proof['fence'] < current: raise PermissionError('stale_coordinator_fence')
        db.execute('UPDATE authority SET fence=?', (proof['fence'],))
        return {'coordinator': 'ADMIN', 'fence': proof['fence'], 'lease_id': proof['lease_id']}

    def authorize(self, action, payload, proof):
        if self.authorizer(action, payload, proof) is not True:
            raise PermissionError('authenticated_parent_or_admin_plan_required')

    def event(self, db, parent, child, state, reason=None):
        db.execute('INSERT INTO events(parent,child,state,reason,at) VALUES(?,?,?,?,?)', (parent, child, state, reason, int(time.time())))

    def record_parent(self, request_id, instruction_sha256, approved_request_ref, *, proof, lease):
        identifier(request_id); identifier(approved_request_ref)
        if not isinstance(instruction_sha256, str) or not re.fullmatch('[a-f0-9]{64}', instruction_sha256):
            raise ValueError('frozen_instruction_hash_required')
        payload = {'request_id': request_id, 'instruction_sha256': instruction_sha256, 'approved_request_ref': approved_request_ref}
        self.authorize('parent', payload, proof)
        with self.exclusive(), self.db() as db:
            db.execute('BEGIN IMMEDIATE'); self.permit(lease, request_id, db)
            old = db.execute('SELECT * FROM parents WHERE id=?', (request_id,)).fetchone()
            if old:
                if old['digest'] != instruction_sha256 or old['approved_ref'] != approved_request_ref:
                    raise ValueError('parent_id_conflict')
            else:
                db.execute('INSERT INTO parents VALUES(?,?,?,NULL,?)', (request_id, instruction_sha256, approved_request_ref, int(time.time())))
                self.event(db, request_id, None, 'needs_plan')
        return self.status(request_id)

    def normalize_plan(self, parent, plan):
        if not isinstance(plan, list) or not 2 <= len(plan) <= 32: raise ValueError('explicit_partitioned_plan_required')
        normalized, tasks, routes, instructions, effects, resources, responsibilities = [], set(), set(), set(), set(), set(), set()
        for item in plan:
            if not isinstance(item, dict) or set(item) != {'task_id','route','responsibility','instruction','effect_key','resources','dependencies'}:
                raise ValueError('exact_plan_fields_required')
            task = identifier(item['task_id']); route = item['route']; effect = identifier(item['effect_key'])
            if route not in self.registry or task in tasks or effect in effects: raise ValueError('plan_target_task_or_effect_conflict')
            body = text(item['instruction'], 8192); responsibility = text(item['responsibility'], 256)
            folded = ' '.join(body.casefold().split())
            if folded in instructions: raise ValueError('identical_instruction_fanout_forbidden')
            responsibility_key=' '.join(responsibility.casefold().split())
            if responsibility_key in responsibilities:raise ValueError('distinct_child_responsibilities_required')
            owned = item['resources']; dependencies = item['dependencies']
            if not isinstance(owned, list) or not 1 <= len(owned) <= 32 or any(not isinstance(x,str) or not x.strip() or len(x)>512 for x in owned) or len(set(owned)) != len(owned):
                raise ValueError('explicit_child_resources_required')
            # Prefix collisions also represent overlapping directories/resources.
            for resource in owned:
                if any(resource == old or resource.startswith(old.rstrip('/')+'/') or old.startswith(resource.rstrip('/')+'/') for old in resources):
                    raise ValueError('child_resource_overlap')
            if not isinstance(dependencies,list) or len(set(dependencies)) != len(dependencies): raise ValueError('invalid_dependencies')
            for dep in dependencies: identifier(dep)
            tasks.add(task); routes.add(route); instructions.add(folded); effects.add(effect); resources.update(owned);responsibilities.add(responsibility_key)
            normalized.append({'task_id':task,'route':route,'responsibility':responsibility,'instruction':body,'effect_key':effect,'resources':sorted(owned),'dependencies':sorted(dependencies)})
        if routes != set(self.registry): raise ValueError('all_registered_project_participants_required')
        pending = {x['task_id']:set(x['dependencies']) for x in normalized}
        if any(not deps.issubset(tasks) for deps in pending.values()): raise ValueError('unknown_dependency')
        while pending:
            ready = {task for task,deps in pending.items() if not deps}
            if not ready: raise ValueError('dependency_cycle')
            pending = {task:deps-ready for task,deps in pending.items() if task not in ready}
        return sorted(normalized, key=lambda x:x['task_id'])

    def install_plan(self, parent_id, plan, *, proof, lease):
        identifier(parent_id); plan = self.normalize_plan(parent_id, plan)
        payload = {'parent_id':parent_id,'coordinator':'ADMIN','plan':plan,'plan_hash':digest(plan)}
        self.authorize('plan', payload, proof)
        with self.exclusive(), self.db() as db:
            db.execute('BEGIN IMMEDIATE'); authority = self.permit(lease,parent_id,db)
            parent = db.execute('SELECT * FROM parents WHERE id=?',(parent_id,)).fetchone()
            if not parent: raise ValueError('approved_parent_required')
            if parent['plan_hash']:
                if parent['plan_hash'] != payload['plan_hash']: raise ValueError('immutable_plan_conflict')
            else:
                for item in plan:
                    child = hashlib.sha256((parent_id+'\0'+item['task_id']).encode()).hexdigest()
                    try:
                        db.execute('INSERT INTO children VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',(child,parent_id,item['task_id'],item['route'],item['instruction'],item['responsibility'],item['effect_key'],canonical(item['resources']),canonical(item['dependencies']),'queued',None,None,None,authority['fence'],int(time.time())))
                    except sqlite3.IntegrityError:
                        raise ValueError('effect_already_owned_by_another_child') from None
                    self.event(db,parent_id,child,'queued')
                db.execute('UPDATE parents SET plan_hash=? WHERE id=?',(payload['plan_hash'],parent_id))
        return self.status(parent_id)

    def dispatch_once(self, parent_id, *, lease):
        with self.exclusive():
            with self.db() as db:
                db.execute('BEGIN IMMEDIATE'); authority=self.permit(lease,parent_id,db)
                rows=db.execute("SELECT * FROM children WHERE parent=? AND state IN ('queued','waiting') ORDER BY task_id",(parent_id,)).fetchall()
                selected=None;waiting_result=None
                for row in rows:
                    deps=json.loads(row['dependencies'])
                    if any(not db.execute("SELECT 1 FROM children WHERE parent=? AND task_id=? AND state='completed'",(parent_id,dep)).fetchone() for dep in deps): continue
                    busy=db.execute("SELECT 1 FROM children WHERE route=? AND state IN ('submitting','running','uncertain') AND id!=?",(row['route'],row['id'])).fetchone()
                    if busy:
                        self.permit(lease,parent_id,db)
                        self.change(db,row,'waiting','route_busy_or_uncertain'); continue
                    try:probe=self.adapter.probe(row['route'])
                    except Exception:probe={'ready':False,'reason':'session_unavailable'}
                    spec=self.registry[row['route']]
                    ready=isinstance(probe,dict) and probe.get('ready') is True and probe.get('target_exists') is True and probe.get('target_id')==spec['target_id'] and probe.get('exclusive') is True and probe.get('state')=='idle' and probe.get('provider')==spec['provider'] and probe.get('model')==spec['model']
                    authority=self.permit(lease,parent_id,db)
                    if not ready:
                        reason=probe.get('reason','bridge_unqualified') if isinstance(probe,dict) else 'bridge_unqualified'
                        if reason not in {'bridge_unqualified','session_busy','session_paused','safety_blocked','limits_exhausted','session_unavailable','provider_model_mismatch'}: reason='bridge_unqualified'
                        self.change(db,row,'waiting',reason)
                        if waiting_result is None:waiting_result={'child_id':row['id'],'state':'waiting','reason':reason}
                        continue
                    selected=row;break
                if selected is None:return waiting_result
                row=selected
                self.change(db,row,'submitting'); db.execute('UPDATE children SET fence=? WHERE id=?',(authority['fence'],row['id']))
            # Intent is committed. Revalidate live authority immediately before
            # external effect; the transport must also reject stale fences.
            try:
                with self.db() as db: authority=self.permit(lease,parent_id,db)
                result=self.adapter.submit(row['route'],row['id'],row['instruction'],{'parent_id':parent_id,'child_id':row['id'],'target_id':self.registry[row['route']]['target_id'],'effect_key':row['effect_key'],'resources':json.loads(row['resources']),**authority})
                state=result.get('state') if isinstance(result,dict) else None
                receipt=result.get('receipt') if isinstance(result,dict) else None
                if state=='accepted' and isinstance(receipt,str) and re.fullmatch('[A-Za-z0-9_.:/=-]{1,256}',receipt): final='running'
                elif state=='rejected': final='failed'; receipt=None
                else: final='uncertain'; receipt=None
            except Exception:
                final,receipt='uncertain',None
            with self.db() as db:
                self.permit(lease,parent_id,db)
                self.change(db,row,final,'submission_uncertain' if final=='uncertain' else None)
                db.execute('UPDATE children SET receipt=? WHERE id=?',(receipt,row['id']))
            return {'child_id':row['id'],'state':final,'receipt':receipt}

    def change(self,db,row,state,reason=None,summary=None):
        if row['state']==state and row['reason']==reason: return
        db.execute('UPDATE children SET state=?,reason=?,summary=COALESCE(?,summary),updated_at=? WHERE id=?',(state,reason,summary,int(time.time()),row['id']))
        self.event(db,row['parent'],row['id'],state,reason)

    def poll_once(self,parent_id,*,lease):
        with self.exclusive():
            with self.db() as db:
                self.permit(lease,parent_id,db)
                row=db.execute("SELECT * FROM children WHERE parent=? AND state='running' ORDER BY task_id LIMIT 1",(parent_id,)).fetchone()
            if not row: return None
            try: result=self.adapter.poll(row['route'],row['receipt'])
            except Exception: return {'child_id':row['id'],'state':'running','reason':'observation_unavailable'}
            with self.db() as db:
                self.permit(lease,parent_id,db)
                if not isinstance(result,dict) or result.get('receipt')!=row['receipt']:
                    self.change(db,row,'uncertain','receipt_mismatch')
                elif result.get('state') in {'completed','failed'}:
                    summary=text(result.get('summary'),4096)
                    self.change(db,row,result['state'],summary=summary)
                elif result.get('state') not in {'running','accepted'}:
                    self.change(db,row,'uncertain','unknown_poll_result')
            return self.status(parent_id)

    def recover(self,parent_id,*,lease):
        with self.exclusive(),self.db() as db:
            db.execute('BEGIN IMMEDIATE');self.permit(lease,parent_id,db)
            for row in db.execute("SELECT * FROM children WHERE parent=? AND state='submitting'",(parent_id,)).fetchall():
                self.change(db,row,'uncertain','interrupted_submission')
        return self.status(parent_id)

    def reconcile(self,parent_id,child_id,*,state,receipt=None,summary=None,proof,lease):
        if state not in {'running','completed','failed'}: raise ValueError('uncertain_cannot_return_to_queue')
        payload={'parent_id':parent_id,'child_id':child_id,'state':state,'receipt':receipt,'summary':summary}
        self.authorize('reconciliation',payload,proof)
        if state=='running': identifier(receipt)
        else: summary=text(summary,4096)
        with self.exclusive(),self.db() as db:
            db.execute('BEGIN IMMEDIATE');self.permit(lease,parent_id,db)
            row=db.execute("SELECT * FROM children WHERE parent=? AND id=? AND state='uncertain'",(parent_id,child_id)).fetchone()
            if not row:raise ValueError('uncertain_child_required')
            self.change(db,row,state,'explicit_reconciliation',summary)
            db.execute('UPDATE children SET receipt=COALESCE(?,receipt) WHERE id=?',(receipt,child_id))
        return self.status(parent_id)

    def status(self,parent_id):
        with self.db() as db:
            parent=db.execute('SELECT * FROM parents WHERE id=?',(parent_id,)).fetchone()
            if not parent: raise KeyError('unknown_parent')
            children=[dict(row) for row in db.execute('SELECT id,task_id,route,responsibility,effect_key,resources,dependencies,state,reason,receipt,summary,fence,updated_at FROM children WHERE parent=? ORDER BY task_id',(parent_id,))]
        for item in children:
            item['resources']=json.loads(item['resources']);item['dependencies']=json.loads(item['dependencies'])
        states={child['state'] for child in children}
        state='needs_plan' if not children else 'uncertain' if 'uncertain' in states else 'completed' if states=={'completed'} else 'failed' if states.issubset({'completed','failed'}) else 'running' if states & {'running','submitting'} else 'waiting' if 'waiting' in states else 'queued'
        return {'parent_id':parent_id,'instruction_sha256':parent['digest'],'approved_request_ref':parent['approved_ref'],'plan_hash':parent['plan_hash'],'state':state,'children':children,'live_integrated':False}
