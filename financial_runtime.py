"""One allocation's financial lifecycle; never a development task dispatcher.

Adapters must implement the existing queue/worker's drain and verified export.
No caller may replace those with a local 'empty queue' assumption. Creation and
activation are separate reviewed operations. This module is not yet installed.
"""
from datetime import datetime, timezone, timedelta
from decimal import Decimal
import hashlib
import json
import os
from pathlib import Path
import re
import stat

from durable_api import atomic, LifecycleLock
from financial_guard import amount, instant, admit

ROOT_BACKUP_UID=0


def owned_resources(receipt, journal_directory, account_id):
    if receipt.get('account_scope_id') != account_id:
        raise ValueError('Receipt account mismatch')
    resources = receipt.get('resources')
    if not isinstance(resources, list) or not resources:
        raise ValueError('Owned allocation receipt missing')
    seen, kinds = set(), []
    for item in resources:
        kind, ident, key = item.get('kind'), item.get('id'), item.get('creation_key')
        if kind not in {'instances', 'volumes'} or not isinstance(ident,str) or not re.fullmatch(r'[0-9a-f-]{36}', ident):
            raise ValueError('Unsupported cleanup target')
        if (kind,ident) in seen: raise ValueError('Duplicate cleanup target')
        seen.add((kind,ident)); kinds.append(kind)
        if not isinstance(key,str) or not re.fullmatch(r'[a-z0-9-]{1,80}',key):
            raise ValueError('Unsafe creation receipt path')
        entry = json.loads((Path(journal_directory)/(key+'.json')).read_text())
        expected_hash = hashlib.sha256(json.dumps(entry['request'],sort_keys=True).encode()).hexdigest()
        if (entry.get('state') != 'completed' or entry.get('request_sha256') != expected_hash
                or entry['request'].get('method') != 'POST'
                or entry['request'].get('path') != '/v2/'+kind
                or entry.get('response',{}).get('id') != ident):
            raise ValueError('No ID-bound creation response for cleanup target')
        if not isinstance(item.get('expected'),dict) or not item['expected']:
            raise ValueError('Expected resource identity absent')
    if kinds.count('instances') != 1 or kinds.count('volumes') > 1:
        raise ValueError('Delegation covers one instance and at most one data volume')
    return sorted(resources,key=lambda x:0 if x['kind']=='instances' else 1)


def matches(current, resource, account_id):
    if current.get('_not_found'): return
    if current.get('id') != resource['id']:
        raise ValueError('API returned another resource')
    if current.get('account_id',account_id) != account_id:
        raise ValueError('Resource belongs to another account')
    if any(str(current.get(k)) != str(v) for k,v in resource['expected'].items()):
        raise ValueError('Live resource identity differs from owned receipt')


class Controller:
    def __init__(self, directory, policy, receipt, api, journal, adapter, observe, gate, clock=None):
        self.root = Path(directory)
        self.policy, self.receipt = policy, receipt
        self.api, self.journal, self.adapter = api, journal, adapter
        self.observe, self.gate = observe, gate
        self.clock = clock or (lambda: datetime.now(timezone.utc))

    def proof_valid(self, proof, resources, instance_id):
        return (proof.get('instance_id') == instance_id and proof.get('worker_frozen') is True
                and proof.get('sha256_verified') is True
                and sorted(proof.get('resource_ids',[])) == sorted(x['id'] for x in resources))

    def own_delete_attempted(self, ident):
        path = self.root/'journal'/('delete-'+ident+'.json')
        if not path.exists(): return False
        entry = json.loads(path.read_text()); request = entry.get('request',{})
        digest = hashlib.sha256(json.dumps(request,sort_keys=True).encode()).hexdigest()
        return (entry.get('request_sha256') == digest
                and request == {'method':'DELETE','path':'/v2/instances/'+ident,'region':'NYC1'}
                and entry.get('state') in {'pending','completed'})

    def verify_backup(self, proof, instance_id):
        expected=self.root/'exports'/('worker-'+instance_id+'.tar.gz')
        if proof.get('backup_path')!=str(expected):raise ValueError('Backup path differs from pinned export path')
        for directory in [self.root,self.root/'exports']:
            info=directory.lstat()
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid!=ROOT_BACKUP_UID
                    or info.st_mode & 0o077):raise ValueError('Backup directory ownership/permissions changed')
        sha=proof.get('sha256')
        if not isinstance(sha,str) or not re.fullmatch('[0-9a-f]{64}',sha):
            raise ValueError('Backup digest missing')
        fd=os.open(expected,os.O_RDONLY | os.O_NOFOLLOW)
        with os.fdopen(fd,'rb') as handle:
            before=os.fstat(handle.fileno())
            if (not stat.S_ISREG(before.st_mode) or before.st_uid!=ROOT_BACKUP_UID
                    or before.st_mode & 0o077 or before.st_nlink!=1):
                raise ValueError('Backup must be a private owned regular file')
            actual=hashlib.file_digest(handle,'sha256').hexdigest()
            after=os.fstat(handle.fileno());current=expected.lstat()
            identity=lambda s:(s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)
            if identity(before)!=identity(after) or identity(current)!=identity(after) or actual!=sha:
                raise ValueError('Backup changed, was replaced or failed checksum')

    def backup_failure(self, now, error):
        return self.status('backup_unavailable_preserving_resources',at=now.isoformat(),
                           cleanup_complete=False,residual_billing_possible=True,error_class=type(error).__name__)

    def status(self, state, **fields):
        value = dict(state=state, admission_open=False, **fields)
        atomic(self.root/'status.json',value)
        return value

    def tick(self, now):
        with LifecycleLock(self.root/'lifecycle.lock'):
            self.gate()  # reviewed persistent authority, never a stale deployment lease
            resources = owned_resources(self.receipt,self.root/'journal',self.policy['account_scope_id'])
            schedule = self.receipt['schedule']
            if schedule['account_scope_id'] != self.policy['account_scope_id']:
                raise ValueError('Schedule account binding mismatch')
            if now < instant(schedule['allocated_at']):
                return self.status('clock_before_allocation', at=now.isoformat())
            insufficient = False
            try:
                charges = self.observe(now)
                decision = admit(schedule,now,3600,charges=charges)
                eligible = decision['allowed']
                insufficient = decision['reason'] == 'cleanup_coverage_insufficient'
            except Exception:
                # Never guess a credit balance, hide an unknown product or admit work.
                eligible = False
            drain = now >= instant(schedule['stop_admission_at']) or not eligible
            if not drain:
                # Queue integration is a separate qualification; no runtime flag here
                # can open admission before that integration has its own review.
                return self.status('funded_allocation_setup_only',at=now.isoformat())
            instance = next(x for x in resources if x['kind']=='instances')
            live_instance = self.api.request('GET','/v2/instances/'+instance['id'],query={'region':'NYC1'})
            matches(live_instance,instance,self.policy['account_scope_id'])
            if live_instance.get('_not_found'):
                # Resume after own delete or process crash, without asking a missing
                # VM to export again. Proof predates the deletion and covers volume.
                proof_path = self.root/'export-proof.json'
                if not proof_path.exists() or not self.own_delete_attempted(instance['id']):
                    return self.status('instance_missing_without_owned_cleanup_proof',at=now.isoformat())
                proof = json.loads(proof_path.read_text())
                if not self.proof_valid(proof,resources,instance['id']):
                    return self.status('export_unverified',at=now.isoformat())
                return self.cleanup(resources,instance,proof,now)
            self.adapter.drain(instance['id'])
            snapshot = self.adapter.snapshot(instance['id'])
            if (snapshot.get('instance_id') != instance['id'] or snapshot.get('admission_closed') is not True
                    or snapshot.get('authority_verified') is not True):
                return self.status('drain_unverified',at=now.isoformat())
            observed = instant(snapshot['at'])
            now = self.clock()
            if now < observed or now-observed > timedelta(minutes=2):
                return self.status('drain_snapshot_stale',at=now.isoformat())
            counts = [snapshot.get(x) for x in ['running','finalizing','exports_pending']]
            if any(type(x) is not int or x<0 for x in counts) or any(counts):
                return self.status('draining_work',at=now.isoformat())
            # Export must freeze the worker, cover all own volumes and survive reboot.
            proof = self.adapter.export_verified(resources)
            if not self.proof_valid(proof,resources,instance['id']):
                return self.status('export_unverified',at=now.isoformat())
            verified = instant(proof['verified_at'])
            now = self.clock()
            if verified < observed or now-verified > timedelta(minutes=2) or verified>now:
                return self.status('export_proof_stale',at=now.isoformat())
            atomic(self.root/'export-proof.json',proof)
            if now < instant(schedule['delete_by']) and not insufficient:
                return self.status('drained_exported_waiting_cutoff',at=now.isoformat())
            return self.cleanup(resources,instance,proof,now)

    def cleanup(self, resources, instance, proof, now):
            try:self.verify_backup(proof,instance['id'])
            except (OSError,ValueError) as error:return self.backup_failure(now,error)
            # Validate every live identity before the first destructive operation.
            for resource in resources:
                current = self.api.request('GET','/v2/'+resource['kind']+'/'+resource['id'],query={'region':'NYC1'})
                matches(current,resource,self.policy['account_scope_id'])
            for resource in resources:
                self.gate()
                path = '/v2/'+resource['kind']+'/'+resource['id']
                current = self.api.request('GET',path,query={'region':'NYC1'})
                matches(current,resource,self.policy['account_scope_id'])
                if current.get('_not_found'): continue
                try:self.verify_backup(proof,instance['id'])
                except (OSError,ValueError) as error:return self.backup_failure(now,error)
                current_instance = self.api.request('GET','/v2/instances/'+instance['id'],query={'region':'NYC1'})
                if not current_instance.get('_not_found'):
                    self.adapter.assert_frozen(instance['id'],proof)
                elif not self.own_delete_attempted(instance['id']):
                    return self.status('missing_owned_instance_delete_attempt',at=now.isoformat())
                request = {'method':'DELETE','path':path,'region':'NYC1'}
                def deletion(resource=resource,path=path):
                    self.verify_backup(proof,instance['id'])
                    response = self.api.request('DELETE',path,query={'region':'NYC1'})
                    # An accepted asynchronous DELETE is not proof billing stopped.
                    return response
                self.journal.perform('delete-'+resource['id'],request,deletion,
                                     lambda value: None if isinstance(value,dict) else (_ for _ in ()).throw(ValueError('Malformed DELETE response')))
                check = self.api.request('GET',path,query={'region':'NYC1'})
                if not check.get('_not_found'):
                    return self.status('deletion_pending',at=now.isoformat())
            return self.status('owned_resources_absent',at=now.isoformat(),deletion_verified=True)
