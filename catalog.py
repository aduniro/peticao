"""Candidate per-node V2 catalog. All generated entries remain unqualified.

Does not write a catalog, activate a worker or relax the frozen V4 allowlist.
Real kinds need separately sealed per-node inputs and actual qualification.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import stat

import profiles
from upstream.runtime import remote_contract as contract

WORKERS = frozenset({'civo', 'akamai', 'azure'})
FIXTURES = frozenset({'fixture-pass', 'fixture-fail'})
KINDS = FIXTURES | profiles.KINDS
DIGESTS = frozenset({'profile_sha256', 'source_sha256', 'dependencies_sha256', 'artifact_policy_sha256'})
PROFILE_KEYS = DIGESTS | {'profile', 'qualified', 'qualification_manifest_event', 'qualification_evidence_sha256'}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def unqualified(kind):
    return {'profile': kind, **{k: '0' * 64 for k in DIGESTS}, 'qualified': False,
            'qualification_manifest_event': None, 'qualification_evidence_sha256': None}


def template():
    nodes = {worker: {'qualified': False, 'profiles': {kind: unqualified(kind) for kind in sorted(KINDS)}} for worker in sorted(WORKERS)}
    # Public dependency/native executable pins from Civo are not qualifications
    # or portable binary evidence for Debian/Akamai or suspended Azure.
    for kind in profiles.KINDS:
        nodes['civo']['profiles'][kind] = profiles.catalog_record(kind)
    return {'version': 2, 'nodes': nodes}


def object_unique(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError('duplicate_catalog_key')
        value[key] = item
    return value


class NodeCatalog:
    def __init__(self, path, validator=contract.root_control_file):
        self.path, self.validator = Path(path), validator

    def load(self):
        path = self.validator(self.path)
        fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
        with os.fdopen(fd, 'rb') as f:
            info = os.fstat(f.fileno())
            if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 65536:
                raise PermissionError('bounded_regular_catalog_required')
            raw = f.read(65537)
        if len(raw) > 65536:
            raise ValueError('catalog_budget')
        value = json.loads(raw, object_pairs_hook=object_unique)
        if type(value) is not dict or set(value) != {'version', 'nodes'} or type(value['version']) is not int or value['version'] != 2 or type(value['nodes']) is not dict or set(value['nodes']) != WORKERS:
            raise ValueError('exact_per_node_catalog_v2_required')
        for worker, node in value['nodes'].items():
            if type(node) is not dict or set(node) != {'qualified', 'profiles'} or type(node['qualified']) is not bool or type(node['profiles']) is not dict or set(node['profiles']) != KINDS:
                raise ValueError('exact_node_and_profile_set_required')
            for kind, record in node['profiles'].items():
                if type(record) is not dict or set(record) != PROFILE_KEYS or record['profile'] != kind or type(record['qualified']) is not bool:
                    raise ValueError('exact_node_profile_record_required')
                for key in DIGESTS:
                    if type(record[key]) is not str or not re.fullmatch('[a-f0-9]{64}', record[key]):
                        raise ValueError('profile_digest_required')
                if record['qualified']:
                    if (type(record['qualification_manifest_event']) is not int or record['qualification_manifest_event'] < 1
                            or type(record['qualification_evidence_sha256']) is not str or not re.fullmatch('[a-f0-9]{64}', record['qualification_evidence_sha256'])
                            or any(record[key] == '0'*64 for key in DIGESTS) or record['qualification_evidence_sha256'] == '0'*64):
                        raise PermissionError('actual_nonzero_profile_qualification_required')
                elif record['qualification_manifest_event'] is not None or record['qualification_evidence_sha256'] is not None:
                    raise ValueError('unqualified_record_cannot_claim_evidence')
                if kind in profiles.KINDS and worker == 'civo':
                    expected = profiles.catalog_record(kind)
                    if any(record[key] != expected[key] for key in DIGESTS | {'profile'}):
                        raise PermissionError('sealed_civo_profile_pins_changed')
        return value

    def select(self, kind, worker):
        if type(kind) is not str or kind not in KINDS or type(worker) is not str or worker not in WORKERS:
            raise ValueError('fixed_profile_and_worker_required')
        node = self.load()['nodes'][worker]
        record = node['profiles'][kind]
        if node['qualified'] is not True or record['qualified'] is not True:
            raise PermissionError('node_profile_not_qualified')
        if kind in profiles.KINDS:
            qualification = profiles.descriptor(kind)['qualification']
            if worker != 'civo' or qualification.get('qualified') is not True or qualification.get('operationalReady') is not True:
                raise PermissionError('real_profile_inputs_and_node_not_qualified')
        return {key: record[key] for key in DIGESTS | {'profile'}}, digest({'worker_id': worker, 'profile': record})
