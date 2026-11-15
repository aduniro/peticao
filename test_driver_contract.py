import copy
import unittest
import driver_contract as c


def complete():
    d=c.dependencies_reference();d['normalized_archive'].update(sha256='a'*64,bytes=12345)
    for key in ('normalization_receipt_sha256','toolchain_inventory_sha256','qa_closure_sha256'):d[key]='b'*64
    for tool in d['toolchain'].values():
        if tool['sha256'] is None:tool['sha256']='c'*64
        if tool['bytes'] is None:tool['bytes']=9876
    d['full_integrity_attestation']={'manifest_event':42,'inventory_sha256':'d'*64,'evidence_sha256':'e'*64}
    return d


class Contract(unittest.TestCase):
    def test_default_candidates_never_ready_or_executable(self):
        for kind in c.KINDS:
            p=c.catalog_candidate(kind)
            self.assertIs(p['qualified'],False);self.assertIs(p['operationalReady'],False)
            self.assertIsNone(p['worker_descriptor']);self.assertIsNone(p['profile_sha256'])
            self.assertIn('driver.program_sha256',p['missing_pins'])
    def test_complete_inputs_still_do_not_qualify(self):
        p=c.catalog_candidate('admin-build-v1','f'*64,complete())
        self.assertIs(p['qualified'],False);self.assertIs(p['operationalReady'],False)
        self.assertEqual(p['profile_sha256'],c.digest(p['worker_descriptor']))
        self.assertNotEqual(p['profile_sha256'],p['plan_sha256'])
        self.assertEqual(set(p['worker_descriptor']),c.DESCRIPTOR_KEYS)
    def test_source_and_tool_paths_pins_are_fixed(self):
        for field,value in [('path','/tmp/python'),('version','22.0'),('sha256','a'*64)]:
            d=complete();d['toolchain']['node'][field]=value
            with self.assertRaises(ValueError):c.validate_dependencies(d,True)
        d=complete();d['normalized_archive']['path']='/tmp/data'
        with self.assertRaises(ValueError):c.validate_dependencies(d)
    def test_forged_readiness_or_origin_boolean_is_not_proof(self):
        d=complete();d['qualified']=True
        with self.assertRaises(ValueError):c.validate_dependencies(d)
        d=complete();d['original_cache_full_integrity_verified']=True
        with self.assertRaises(ValueError):c.validate_dependencies(d)
        d=complete();d['full_integrity_attestation']['manifest_event']=True
        with self.assertRaises(ValueError):c.validate_dependencies(d)
    def test_pending_is_explicit_and_execution_refuses(self):
        d=c.dependencies_reference();missing=c.validate_dependencies(d)
        self.assertIn('toolchain.python.sha256',missing);self.assertIn('toolchain.chromium.sha256',missing)
        with self.assertRaises(PermissionError):c.validate_dependencies(d,True)
    def test_bad_schema_and_nonfinite_are_refused(self):
        for value in (None,False,[],{'version':1}):
            with self.assertRaises(ValueError):c.validate_dependencies(value)
        with self.assertRaises(ValueError):c.canonical(float('nan'))
        for value in (True,-1,1.1):
            d=complete();d['normalized_archive']['bytes']=value
            with self.assertRaises(ValueError):c.validate_dependencies(d)
    def test_worker_digest_binds_resource_and_policy(self):
        d=complete();a=c.worker_descriptor('admin-build-v1','f'*64,d)
        b=c.worker_descriptor('admin-build-v1','f'*64,d,'balanced-v1')
        self.assertNotEqual(c.digest(a),c.digest(b));self.assertEqual(a['resources']['memory_bytes'],20*1024**3)
        changed=copy.deepcopy(a);changed['resources']['memory_bytes']=24*1024**3
        with self.assertRaises(ValueError):c.validate_worker_descriptor(changed)
        changed=copy.deepcopy(a);changed['artifact_policy']['max_files']=8
        with self.assertRaises(ValueError):c.validate_worker_descriptor(changed)
    def test_worker_path_name_or_version_cannot_be_overridden(self):
        d=c.worker_descriptor('admin-typecheck-v1','f'*64,complete())
        for key,value in [('name','shell'),('name',[]),('version',True),('program','/bin/sh'),('python_path','/usr/bin/python')]:
            changed=copy.deepcopy(d);changed[key]=value
            with self.assertRaises(ValueError):c.validate_worker_descriptor(changed)
    def test_qa_builds_own_compiled_runtime_before_exact100(self):
        p=c.plan('admin-qa-v1');names=p['phases']
        self.assertLess(names.index('typecheck'),names.index('build'))
        self.assertLess(names.index('build'),names.index('export-runtime'))
        self.assertLess(names.index('export-runtime'),names.index('qa100'))
        self.assertLess(p['qa_steps'].index('maps2'),p['qa_steps'].index('http-reset8'))
        self.assertEqual(sum(p['qa_counts'].values()),100)
        self.assertIs(p['layout']['old_paths_or_units_reused'],False)
    def test_relative_paths_only(self):
        self.assertEqual(c.relative_path('source/site'),'source/site')
        for value in ('/tmp','../x','a/../b','a//b','./x','a\\b','',False):
            with self.assertRaises(ValueError):c.relative_path(value)
    def test_parent_archive_types_not_just_python_equality(self):
        d=complete();d['parent_archive']['bytes']=float(c.PARENT_DEPS['bytes'])
        with self.assertRaises(ValueError):c.validate_dependencies(d)

if __name__=='__main__':unittest.main()
