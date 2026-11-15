"""Candidate paired adapter for frozen legacy coordinator3080; not installed.

Uses the existing coordinator's queue/authority/config/event helpers. Never calls
the old unguarded dispatch_once, does not create another loop or queue. Default
missing guard blocks launches. Legacy terminal provider qualification is pending.
"""
import hashlib
import json
from pathlib import Path
import subprocess

from shared_guard import GuardPending, job_worker


class PairedLegacyDispatcher:
    def __init__(self, legacy, paired_guard=None, terminal_provider=None, launcher=None):
        self.legacy,self.guard,self.terminal_provider=legacy,paired_guard,terminal_provider
        self.launcher=launcher or self._launch
        self.worker='civo'

    def _launch(self, job):
        self.legacy.validate_id(job)
        if self.legacy.LAUNCHER!='/usr/local/libexec/admin-v2-launch':
            raise GuardPending('fixed_legacy_launcher_required')
        subprocess.run(['/usr/bin/sudo','-n',self.legacy.LAUNCHER,job],check=True,capture_output=True,timeout=20)

    def dispatch_once(self):
        if self.guard is None:
            raise GuardPending('paired_guard_required_before_any_effect')
        current=self.legacy.primary()
        with self.legacy.connect() as db:
            db.execute('PRAGMA synchronous=FULL');db.execute('BEGIN IMMEDIATE')
            self.guard.check(db,self.worker)
            if db.execute('SELECT 1 FROM canonical_consumer_slots WHERE worker_id=? AND active=1',(self.worker,)).fetchone():
                return None
            active=db.execute("SELECT * FROM jobs WHERE state IN ('starting','running')").fetchall()
            if any(job_worker(row,self.worker)==self.worker for row in active):return None
            row=next((r for r in db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY created_at,id") if not self.legacy.remote_job(r)),None)
            if row is None:return None
            self.legacy.validate_id(row['id'])
            if row['generation']!=current['generation']:
                # No stale job is dispatched and no slot is silently recycled.
                raise GuardPending('legacy_generation_changed_no_launch')
            if self.legacy.primary()!=current:raise GuardPending('authority_changed_before_legacy_reserve')
            self.guard.reserve_legacy(db,row,self.worker,current['generation'],self.legacy.stamp())
            folder=self.legacy.WORKER/'jobs'/row['id']
            folder.mkdir(mode=0o2770);folder.chmod(0o2770)
            self.legacy.atomic(folder/'config.json',{'id':row['id'],'payload':json.loads(row['payload']),
                               'digest':row['digest'],'generation':row['generation']},0o660)
            db.execute("UPDATE jobs SET state='starting',updated_at=? WHERE id=?",(self.legacy.stamp(),row['id']))
            self.legacy.event(db,row['id'],'starting',{'generation':row['generation'],'paired_slot':True})
        try:
            with self.legacy.connect() as db:
                db.execute('BEGIN')
                self.guard.check(db,self.worker)
                slot=db.execute('SELECT * FROM canonical_consumer_slots WHERE job_id=?',(row['id'],)).fetchone()
                if (slot is None or not slot['active'] or slot['worker_id']!=self.worker or slot['backend']!='legacy-local'
                        or slot['generation']!=current['generation'] or self.legacy.primary()!=current):
                    raise GuardPending('legacy_authority_or_slot_changed_before_launch')
            self.launcher(row['id'])
        except (OSError,subprocess.SubprocessError):
            # Could have launched. Keep both existing starting state and slot.
            with self.legacy.connect() as db:
                db.execute("UPDATE jobs SET error='launcher_result_uncertain' WHERE id=?",(row['id'],))
                self.legacy.event(db,row['id'],'launcher_result_uncertain',{})
        return row['id']

    def retire(self, job):
        self.legacy.validate_id(job)
        if self.guard is None or self.terminal_provider is None:
            raise GuardPending('qualified_legacy_guard_and_terminal_provider_pending')
        current=self.legacy.primary()
        with self.legacy.connect() as db:
            db.execute('BEGIN')
            self.guard.check(db,self.worker)
            row=db.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone()
            if row is None or row['generation']!=current['generation'] or row['state'] not in {'completed','failed','canceled'}:
                raise GuardPending('bound_terminal_legacy_job_before_custody_required')
        # The future root-controlled provider must verify actual own stopped unit,
        # cgroup/process drain and durable independent artifact custody. This is
        # a private callback, never an RPC action accepting caller proof/paths.
        proof=self.terminal_provider(job)
        with self.legacy.connect() as db:
            db.execute('PRAGMA synchronous=FULL');db.execute('BEGIN IMMEDIATE')
            self.guard.check(db,self.worker)
            row=db.execute('SELECT * FROM jobs WHERE id=?',(job,)).fetchone()
            if row is None or row['generation']!=current['generation'] or self.legacy.primary()!=current:
                raise GuardPending('current_same_legacy_job_required')
            result=self.guard.release_legacy(db,row,self.worker,proof,self.legacy.stamp())
            if result['changed']:self.legacy.event(db,job,'legacy_slot_retired',{'custody_receipt_sha256':proof['custody_receipt_sha256']})
            return result
