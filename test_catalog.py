import copy
import json
from pathlib import Path
import tempfile
import unittest

import catalog

HERE = Path(__file__).resolve().parent


class CatalogTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(dir=HERE, prefix='fixture-catalog-')
        self.addCleanup(self.tmp.cleanup)
        self.path = Path(self.tmp.name) / 'catalog.json'
        self.value = catalog.template()
        self.catalog = catalog.NodeCatalog(self.path, validator=lambda p: p)
        self.write()

    def write(self): self.path.write_text(json.dumps(self.value))

    def qualify_fixture(self, worker='civo'):
        node = self.value['nodes'][worker]; node['qualified'] = True
        record = node['profiles']['fixture-pass'];record['qualified'] = True
        record.update({key:'a'*64 for key in catalog.DIGESTS})
        record.update(qualification_manifest_event=1,qualification_evidence_sha256='b'*64)

    def test_all_templates_are_unqualified_and_other_nodes_have_no_borrowed_pins(self):
        value=self.catalog.load()
        for worker,node in value['nodes'].items():
            self.assertFalse(node['qualified'])
            for kind,record in node['profiles'].items():
                self.assertFalse(record['qualified']);self.assertIsNone(record['qualification_manifest_event'])
                if worker!='civo':self.assertTrue(all(record[k]=='0'*64 for k in catalog.DIGESTS))
        for kind in catalog.KINDS:
            with self.assertRaises(PermissionError):self.catalog.select(kind,'civo')

    def test_selected_entry_hash_is_not_invalidated_by_unrelated_node(self):
        self.qualify_fixture();self.write();selected=self.catalog.select('fixture-pass','civo')
        self.value['nodes']['akamai']['profiles']['fixture-fail']['source_sha256']='c'*64;self.write()
        self.assertEqual(selected,self.catalog.select('fixture-pass','civo'))

    def test_real_metadata_flags_do_not_replace_input_qualification(self):
        node=self.value['nodes']['civo'];node['qualified']=True
        record=node['profiles']['admin-build-v1'];record.update(qualified=True,qualification_manifest_event=3195,qualification_evidence_sha256='d'*64);self.write()
        with self.assertRaises(PermissionError):self.catalog.select('admin-build-v1','civo')

    def test_sealed_real_hash_cannot_be_replaced_by_json(self):
        self.value['nodes']['civo']['profiles']['admin-qa-v1']['profile_sha256']='c'*64;self.write()
        with self.assertRaises(PermissionError):self.catalog.load()

    def test_unknown_fields_kind_node_and_bool_event_are_refused(self):
        original=copy.deepcopy(self.value)
        for action in ('field','kind','node','event'):
            self.value=copy.deepcopy(original)
            if action=='field':self.value['extra']=True
            elif action=='kind':self.value['nodes']['civo']['profiles']['free-command']={}
            elif action=='node':self.value['nodes']['new-node']={}
            else:self.qualify_fixture();self.value['nodes']['civo']['profiles']['fixture-pass']['qualification_manifest_event']=True
            self.write()
            with self.assertRaises((ValueError,PermissionError)):self.catalog.load()

    def test_duplicate_json_keys_and_links_are_refused(self):
        self.path.write_text('{"version":2,"version":2,"nodes":{}}')
        with self.assertRaises(ValueError):self.catalog.load()
        self.path.unlink();other=self.path.parent/'other.json';other.write_text(json.dumps(catalog.template()));self.path.symlink_to(other)
        with self.assertRaises(OSError):self.catalog.load()

    def test_default_validator_does_not_accept_current_user_fixture(self):
        with self.assertRaises(PermissionError):catalog.NodeCatalog(self.path).load()


if __name__=='__main__':unittest.main()
