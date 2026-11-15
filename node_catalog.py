"""Per-worker catalog: heterogeneous OS/interpreter profiles are distinct.

Implements the select(kind,worker) interface of facade3080. Only the selected
entry is bound, so adding an unrelated node doesn't invalidate a queued job.
"""
import json
from pathlib import Path

import remote_contract as contract
import profile_contract

DIGESTS={'profile_sha256','source_sha256','dependencies_sha256','artifact_policy_sha256'}
KINDS=profile_contract.NAMES


class NodeCatalog:
    def __init__(self,path,validator=contract.root_control_file):self.path,self.validator=Path(path),validator

    def load(self):
        path=self.validator(self.path)
        if path.stat().st_size>65536:raise ValueError('bounded_node_catalog_required')
        value=json.loads(path.read_bytes())
        if not isinstance(value,dict) or set(value)!={'version','nodes'} or type(value['version']) is not int or value['version']!=2 or set(value['nodes'])!=contract.WORKERS:
            raise ValueError('exact_per_worker_catalog_required')
        for worker,node in value['nodes'].items():
            if not isinstance(node,dict) or set(node)!={'qualified','profiles'} or type(node['qualified']) is not bool or type(node['profiles']) is not dict or not node['profiles'] or set(node['profiles'])-KINDS:raise ValueError('exact_node_fields_required')
            for kind,p in node['profiles'].items():
                if (not isinstance(p,dict) or set(p)!=DIGESTS|{'profile','qualified','qualification_manifest_event','qualification_evidence_sha256'}
                        or p['profile']!=kind or type(p['qualified']) is not bool):raise ValueError('exact_node_profile_required')
                for k in DIGESTS:contract.hex_value(p[k],64)
                if p['qualified']:
                    if type(p['qualification_manifest_event']) is not int or p['qualification_manifest_event']<1:raise PermissionError('actual_profile_qualification_reference_required')
                    contract.hex_value(p['qualification_evidence_sha256'],64)
                elif p['qualification_manifest_event'] is not None or p['qualification_evidence_sha256'] is not None:
                    raise ValueError('unqualified_entry_has_no_qualification')
        return value

    def select(self,kind,worker):
        if type(kind) is not str or kind not in KINDS or type(worker) is not str or worker not in contract.WORKERS:raise ValueError('fixed_profile_and_node_required')
        node=self.load()['nodes'][worker];profile=node['profiles'][kind]
        if node['qualified'] is not True or profile['qualified'] is not True:raise PermissionError('node_profile_not_qualified')
        return {k:profile[k] for k in DIGESTS|{'profile'}},contract.digest({'worker_id':worker,'profile':profile})
