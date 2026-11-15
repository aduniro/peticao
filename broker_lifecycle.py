"""Persistent WorkerRPC with durable, authenticated post-custody retirement.

The coordinator's custody digest is an attestation by the launch-token holder,
not an independent observation of a remote disk. Only that coordinator may send
retire after it has verified and fsynced custody. No token is written here.
"""
import hashlib
import hmac
import json
import os
import re
from pathlib import Path
import stat

import artifacts
import remote_contract as c


class RetirementUncertain(RuntimeError):
    pass


class Lifecycle:
    def __init__(self, service, references, retirement_root):
        if service.adapter.references is not references:
            raise PermissionError('one_persistent_reference_owner_required')
        self.service, self.references = service, references
        self.root = artifacts.private_root(retirement_root)
        self.pid = os.getpid()
        self.uncertain = False

    def check(self):
        if self.pid != os.getpid() or self.uncertain:
            raise RetirementUncertain('original_non_uncertain_broker_required')
        self.references.check()
        self.epoch_check()

    def epoch_check(self):
        if self.pid != os.getpid():
            raise RetirementUncertain('original_broker_process_required')
        journal, admission = self.service.journal, self.service.admission
        # WorkerJournal._epoch only checks SQLite metadata. It is NOT an
        # EpochGuard check. Bind every call (including reads/empty startup) to
        # the persistent floor sealed into this node's admission metadata.
        with admission.lock():
            data = json.loads(admission.validator(admission.root/'admission.json').read_text())
            if (not isinstance(data, dict) or set(data) != {'enabled', 'epoch_sha256'}
                    or type(data['enabled']) is not bool):
                raise PermissionError('typed_worker_admission_epoch_required')
            c.hex_value(data['epoch_sha256'], 64)
            guard = journal.epoch_guard
            floor = json.loads(guard.control_validator(guard.path).read_text())
            if (not isinstance(floor, dict) or set(floor) != c.EpochGuard.KEYS
                    or type(floor['generation']) is not int
                    or floor['primary_host'] != 'civo'
                    or not isinstance(floor['coordinator_boot_id'], str)
                    or not re.fullmatch('[a-zA-Z0-9-]{1,80}', floor['coordinator_boot_id'])):
                raise PermissionError('typed_persistent_worker_epoch_required')
            guard.require(journal.generation, floor['primary_host'], floor['coordinator_boot_id'],
                          floor['operation_id'], data['epoch_sha256'])
            with c.transaction(journal.path) as db:
                journal._epoch(db)

    def identity(self, request):
        if set(request) != {'action', 'manifest', 'token', 'receipt_sha256',
                            'bundle_sha256', 'custody_receipt_sha256'}:
            raise ValueError('exact_retirement_request_required')
        m = request['manifest']
        c.validate_manifest(m, self.service.journal.profiles)
        self.service.journal._manifest(m)
        for key in ('token', 'receipt_sha256', 'bundle_sha256', 'custody_receipt_sha256'):
            c.hex_value(request[key], 64)
        row, binding = self.service.stored(m['job_id'])
        if (row['manifest_json'] != c.canonical(m)
                or row['receipt_sha256'] != request['receipt_sha256']
                or not hmac.compare_digest(row['token_sha256'], hashlib.sha256(request['token'].encode()).hexdigest())):
            raise PermissionError('authenticated_exact_worker_custody_attestation_required')
        if (row['state'] not in {'completed', 'failed', 'canceled'} or not binding
                or not binding['stop_proof'] or not binding['finalized_result']
                or binding['bundle_sha256'] != request['bundle_sha256']):
            raise PermissionError('finalized_bound_bundle_before_retirement_required')
        receipt = json.loads(row['receipt_json'])
        c.validate_receipt(receipt, m, c.digest(m))
        if row['receipt_sha256'] != c.digest(receipt):
            raise PermissionError('stored_worker_receipt_digest_mismatch')
        self.validate_terminal(m, receipt, row, binding)
        identity = {'job_id': m['job_id'], 'generation': m['generation'],
                    'manifest_sha256': c.digest(m), 'receipt_sha256': c.digest(receipt),
                    'bundle_sha256': binding['bundle_sha256'],
                    'custody_receipt_sha256': request['custody_receipt_sha256'],
                    'invocation_id': binding['invocation_id'], 'worker_boot_id': receipt['boot_id']}
        return m, receipt, binding, identity

    def validate_terminal(self, m, receipt, row, binding):
        proof = json.loads(binding['stop_proof'])
        fields = {'unit', 'invocation_id', 'worker_boot_id', 'main_pid', 'cgroup_empty',
                  'unit_stopped', 'exit_code', 'canceled', 'receipt_sha256'}
        if (set(proof) != fields or row['invocation_id'] != binding['invocation_id']
                or binding['receipt_sha256'] != c.digest(receipt)
                or receipt['boot_id'] != self.service.journal.boot_id()
                or proof['worker_boot_id'] != receipt['boot_id']
                or proof['unit'] != receipt['unit']
                or proof['invocation_id'] != binding['invocation_id']
                or proof['receipt_sha256'] != c.digest(receipt)
                or type(proof['main_pid']) is not int or proof['main_pid'] != 0
                or proof['cgroup_empty'] is not True or proof['unit_stopped'] is not True
                or type(proof['canceled']) is not bool
                or proof['canceled'] != (row['state'] == 'canceled')
                or proof['exit_code'] is not None and (type(proof['exit_code']) is not int or not 0 <= proof['exit_code'] <= 255)):
            raise PermissionError('durable_bound_stop_before_retirement_required')
        c.hex_value(binding['invocation_id'], 32)
        c.hex_value(binding['bundle_sha256'], 64)
        result = json.loads(binding['finalized_result'])
        expected_identity = {'job_id': m['job_id'], 'generation': m['generation'],
                             'manifest_sha256': c.digest(m), 'receipt_sha256': c.digest(receipt),
                             'invocation_id': binding['invocation_id'], 'worker_boot_id': receipt['boot_id']}
        if (not isinstance(result, dict) or type(result.get('protocol')) is not int or result['protocol'] != 1
                or result.get('identity') != expected_identity or result.get('profile') != m['profile']
                or result.get('outcome') != row['state'] or result.get('unit_stop') != proof
                or result.get('exit_code') != proof['exit_code']
                or type(result.get('runner_report_valid')) is not bool
                or row['state'] == 'completed' and (proof['exit_code'] != 0 or result['runner_report_valid'] is not True)):
            raise PermissionError('finalized_result_identity_and_outcome_required')
        payload = artifacts.file_bytes(self.service.exports / (m['job_id'] + '.tar'), artifacts.MAX_BYTES)
        if artifacts.sha(payload) != binding['bundle_sha256']:
            raise PermissionError('sealed_worker_bundle_changed')

    def read(self, path):
        # Reads one validated descriptor; never reopen a raced path for fsync.
        path = c.private_file(path)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as f:
            i = os.fstat(f.fileno())
            if not stat.S_ISREG(i.st_mode) or i.st_nlink != 1 or i.st_uid != os.geteuid() or stat.S_IMODE(i.st_mode) != 0o600:
                raise PermissionError('private_retirement_receipt_required')
            raw = f.read(65537)
            if len(raw) > 65536:
                raise ValueError('bounded_retirement_receipt_required')
            value = json.loads(raw)
            # Visible complete bytes after crash do not alone prove durability.
            os.fsync(f.fileno())
        artifacts.sync_dir(path.parent)
        return value

    def retained(self, manifest, receipt, binding):
        value = self.service.adapter.storage.status(manifest, receipt)
        if (value.get('state') != 'retained' or value.get('mount_absent') is not True
                or value.get('manifest_sha256') != c.digest(manifest)
                or value.get('receipt_sha256') != c.digest(receipt)
                or value.get('stopped_invocation_id') != binding['invocation_id']):
            raise PermissionError('exact_retained_storage_readback_required')
        return value

    def retire(self, request):
        m = request.get('manifest')
        c.validate_manifest(m, self.service.journal.profiles)
        with self.service.admission.mutation(m), self.service.job_lock(m['job_id']):
            self.check()
            m, receipt, binding, identity = self.identity(request)
            directory = self.root / m['job_id']
            if os.path.lexists(directory):
                artifacts.private_root(directory)
                if self.read(directory / 'intent.json') != identity:
                    raise PermissionError('retirement_identity_changed_no_replay')
                if not (directory / 'receipt.json').exists():
                    raise RetirementUncertain('retirement_intent_without_receipt_no_replay')
                saved = self.read(directory / 'receipt.json')
                expected = {'state': 'retained', 'identity': identity,
                            'unit_reference_released': True}
                if saved != expected:
                    raise PermissionError('exact_retirement_receipt_required')
                self.retained(m, receipt, binding)
                # Duplicate is only durable-receipt/storage verification. No
                # Ref acquisition, systemctl stop, unmount or Unref replay.
                return saved
            os.mkdir(directory, 0o700)
            artifacts.sync_dir(self.root)
            try:
                artifacts.durable_json(directory / 'intent.json', identity)
                descriptor = self.service.descriptor(m)
                self.service.adapter.cleanup_storage(m, receipt, descriptor, binding)
                self.retained(m, receipt, binding)
                ref = self.references.snapshot(receipt['unit'])
                if (ref['state'] != 'released' or ref['connection_uncertain'] is not False
                        or ref['invocation_id'] != binding['invocation_id']):
                    raise PermissionError('released_original_unit_reference_required')
                saved = {'state': 'retained', 'identity': identity,
                         'unit_reference_released': True}
                artifacts.durable_json(directory / 'receipt.json', saved)
                if self.read(directory / 'receipt.json') != saved:
                    raise PermissionError('durable_retirement_readback_required')
                return saved
            except BaseException:
                self.uncertain = True
                raise

    def retirement(self, request):
        """Observe a lost response through its durable receipt, never cleanup.

        This remains available in quarantine without creating/rearming a Ref.
        Missing/partial state is uncertain, not an invitation to send retire.
        """
        self.epoch_check()
        m, receipt, binding, identity = self.identity(request)
        directory = self.root / m['job_id']
        if not os.path.lexists(directory):
            return {'state': 'uncertain', 'no_replay': True}
        artifacts.private_root(directory)
        if self.read(directory / 'intent.json') != identity:
            raise PermissionError('retirement_identity_changed_no_replay')
        if not (directory / 'receipt.json').exists():
            return {'state': 'uncertain', 'no_replay': True}
        saved = self.read(directory / 'receipt.json')
        if saved != {'state': 'retained', 'identity': identity, 'unit_reference_released': True}:
            raise PermissionError('exact_retirement_receipt_required')
        self.retained(m, receipt, binding)
        return saved

    def startup(self):
        """Read/reconcile before accepting a listener; never recreate a Ref.

        Previously running/start-intent/finalized-but-not-retired work requires
        exact operator reconciliation, not an automatic new keeper or rerun.
        Prepared-but-never-started receipts can continue on the same boot.
        """
        self.check()
        with c.transaction(self.service.journal.path) as db:
            rows = [dict(r) for r in db.execute('SELECT * FROM receipts')]
            bindings = {r['job_id']: dict(r) for r in db.execute('SELECT * FROM unit_bindings')}
        known = {r['job_id'] for r in rows}
        if set(bindings) - known or set(p.name for p in self.root.iterdir()) - known:
            raise RetirementUncertain('foreign_worker_retirement_or_binding_requires_reconciliation')
        for row in rows:
            m, receipt = json.loads(row['manifest_json']), json.loads(row['receipt_json'])
            c.validate_manifest(m, self.service.journal.profiles)
            self.service.journal._manifest(m)
            c.validate_receipt(receipt, m, c.digest(m))
            if (row['job_id'] != m['job_id'] or row['receipt_sha256'] != c.digest(receipt)
                    or receipt['boot_id'] != self.service.journal.boot_id()):
                raise RetirementUncertain('worker_journal_identity_or_boot_requires_reconciliation')
            state = self.service.adapter.properties(receipt['unit'])
            if (state['MainPID'] != '0' or state['ActiveState'] not in {'inactive', 'failed'}
                    or state['ControlGroup'] and not self.service.adapter.cgroup_empty(state['ControlGroup'])):
                raise RetirementUncertain('previous_worker_process_requires_reconciliation')
            directory = self.root / row['job_id']
            if row['state'] in {'prepared', 'canceled_before_start'}:
                if row['invocation_id'] is not None or row['job_id'] in bindings or os.path.lexists(directory) or state['LoadState'] != 'not-found':
                    raise RetirementUncertain('prepared_worker_has_execution_evidence')
                try:
                    self.service.adapter.storage.status(m, receipt)
                except FileNotFoundError:
                    continue
                raise RetirementUncertain('prepared_worker_has_storage_evidence')
            binding = bindings.get(row['job_id'])
            if row['state'] not in {'completed', 'failed', 'canceled'} or not binding or not binding['stop_proof'] or not binding['bundle_sha256']:
                raise RetirementUncertain('previous_execution_not_retired_no_rearm')
            self.validate_terminal(m, receipt, row, binding)
            artifacts.private_root(directory)
            intent, saved = self.read(directory / 'intent.json'), self.read(directory / 'receipt.json')
            expected = {'job_id': m['job_id'], 'generation': m['generation'],
                        'manifest_sha256': c.digest(m), 'receipt_sha256': c.digest(receipt),
                        'bundle_sha256': binding['bundle_sha256'],
                        'custody_receipt_sha256': intent.get('custody_receipt_sha256'),
                        'invocation_id': binding['invocation_id'], 'worker_boot_id': receipt['boot_id']}
            c.hex_value(expected['custody_receipt_sha256'], 64)
            if intent != expected or saved != {'state': 'retained', 'identity': expected, 'unit_reference_released': True}:
                raise RetirementUncertain('previous_retirement_identity_requires_reconciliation')
            if state['LoadState'] != 'not-found' and state['InvocationID'] != binding['invocation_id']:
                raise RetirementUncertain('previous_worker_unit_recreated')
            self.retained(m, receipt, binding)
        return {'state': 'RECONCILED', 'receipt_count': len(rows)}

    def __call__(self, request):
        if request.get('action') == 'retirement':
            return self.retirement(request)
        if self.uncertain and request.get('action') in {'observe', 'logs', 'bundle'}:
            self.epoch_check()
            return self.service.rpc(request)
        self.check()
        if request.get('action') == 'retire':
            return self.retire(request)
        return self.service.rpc(request)
