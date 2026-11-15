"""Private fixture source/deps and mocked Supervisor only; no native workload.

The real driver Context/env factory and Supervisor environment validator are
exercised without spawning any process or reading public production tool data.
"""
import hashlib
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest import mock

import driver
import driver_contract
import process_runner
import resource_plan
import runtime_steps as steps

TMP = Path('/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp')


def raw(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def put(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(value); path.chmod(0o600)


class FixtureSupervisor:
    def __init__(self, ctx, pdf_lock, fixture_asset):
        self.root = str(ctx.root); self.allowed_executables = {str(ctx.node): driver_contract.NODE_SHA}
        self.ctx, self.pdf_lock, self.fixture_asset = ctx, pdf_lock, fixture_asset
        self.calls = []; self.fail = None; self.mutate = None; self.denial = False; self.installed = True

    def run(self, name, argv, **kwargs):
        self.calls.append((name, argv, kwargs))
        if name == 'prepare-offline-assets':
            base = self.ctx.site / 'public/vendor/pdfjs/6.5.438'
            put(base / 'pdf.mjs', self.fixture_asset)
            put(base / 'assets-version.json', raw({'version':'6.5.438', 'archiveIntegrity':self.pdf_lock['archiveIntegrity'], 'assets':1}))
        if name == 'build':
            for path, content in {
                '.next/BUILD_ID': b'fixture-build', '.next/server/app.js': b'fixture-compiled-js',
                '.next/cache/private': steps.BUILD_MARKERS[0], '.next/types/private.ts': b'excluded-types',
                '.next/trace': b'excluded-private-trace',
                '.next/required-server-files.json': raw({'version':1,'files':['.next/BUILD_ID','.next/server/app.js','next.config.mjs','package.json']}),
            }.items(): put(self.ctx.site / path, content)
            records = []
            if self.installed: records.append({'kind':'installed'})
            if self.denial: records.append({'kind':'fetch'})
            if records: put(self.ctx.root / 'private-build/t/build-guard.jsonl', b''.join(raw(row) + b'\n' for row in records))
        if self.mutate: self.mutate(name)
        observed = 0
        if self.fail != name:
            try: observed = kwargs['observed_checks']()
            except (steps.RuntimePending, OSError): pass
        return {'name':name,'exit_code':1 if self.fail == name else 0,'signal':None,'duration_ms':1,
                'expected_checks':kwargs['expected_checks'],'observed_checks':observed,
                'success':self.fail != name and observed == kwargs['expected_checks']}


class RuntimeStepsTests(unittest.TestCase):
    def setUp(self):
        TMP.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.tmp = tempfile.TemporaryDirectory(prefix='runtime-steps-', dir=TMP)
        self.root = Path(self.tmp.name); self.cwd = Path.cwd(); os.chdir(self.root)
        self.lock = {'lockfileVersion':3,'packages':{'':{'version':'1.0.0'},
            'node_modules/next':{'version':'14.2.35'}, 'node_modules/pg':{'version':'8.23.1'},
            'node_modules/typescript':{'version':'5.9.3','dev':True},
            'node_modules/win-only':{'version':'1.0.0','optional':True,'os':['win32']}}}
        self.lock_bytes = raw(self.lock)
        self.asset = b'fixture-pdfjs-browser-asset-never-imported'
        self.pdf_lock = {'package':'pdfjs-dist','version':'6.5.438','archiveSize':4,
            'archiveIntegrity':'sha512-fixture-only',
            'files':{'package/build/pdf.mjs':{'path':'pdf.mjs','size':len(self.asset),'sha256':hashlib.sha256(self.asset).hexdigest()}}}
        self.source_files = {
            'AGENTS.md':b'fixture', 'site/package-lock.json':self.lock_bytes,
            'site/package.json':raw({'name':'fixture-app','version':'1.0.0'}),
            'site/next.config.mjs':b'export default {};', 'site/src/app.ts':b'original-source',
            'site/.env.example':b'EXAMPLE=fixture', 'site/public/logo.svg':b'fixture-svg',
            'site/assets/font.otf':b'fixture-font', 'site/scripts/pdfjs-assets.lock.json':raw(self.pdf_lock),
            'site/scripts/prepare-pdfjs-assets.mjs':b'// fixture, never executed',
            'tools/preview/check.ts':b'fixture-preview', 'tools/admin-qa/old.py':b'# never execute',
        }
        self.deps_files = {'package-lock.json':self.lock_bytes,'node':b'archive-node-must-never-run','package.tgz':b'fake-pdfjs',
            'node_modules/next/package.json':raw({'version':'14.2.35'}),'node_modules/next/dist/bin/next':b'fixture-next-never-run',
            'node_modules/pg/package.json':raw({'version':'8.23.1'}),'node_modules/pg/lib/index.js':b'fixture-pg-never-run',
            'node_modules/typescript/package.json':raw({'version':'5.9.3'}),'node_modules/typescript/bin/tsc':b'fixture-tsc-never-run'}
        deps = driver_contract.dependencies_reference()
        deps['normalized_archive'].update(sha256='a'*64,bytes=100)
        policy = {'dependencies_ref':deps,'plans':{'admin-build-v1':{'resources':resource_plan.plan('balanced-v1')}},
                  'qa_inventory':{'qa/build-guard.mjs':{'sha256':'b'*64,'bytes':7}}}
        self.ctx = driver.Context(self.root,'admin-build-v1',policy,driver_contract)
        self.supervisor = FixtureSupervisor(self.ctx,self.pdf_lock,self.asset)
        def extract(path, sha, size, dest, kind):
            files = self.source_files if kind == 'source' else self.deps_files
            destination = self.root / dest; destination.mkdir(mode=0o700)
            for name, value in files.items(): put(destination / name,value)
            return {'version':1,'kind':kind,'members':len(files),'unpacked_bytes':sum(len(value) for value in files.values()),
                    'entries':[{'name':name,'type':'file','size':len(value),'mode':0o644} for name,value in files.items()],
                    'qualified':False,'cache_integrity_verified':False}
        self.extract = mock.patch.object(steps.input_provider,'extract_input',side_effect=extract)
        self.public = mock.patch.object(steps,'_public',return_value=b'fixture-verified-public-data')
        self.pins = mock.patch.multiple(steps,LOCK_SHA256=hashlib.sha256(self.lock_bytes).hexdigest(),PDFJS_LOCK_SHA256=hashlib.sha256(raw(self.pdf_lock)).hexdigest())
        self.extract.start(); self.public.start(); self.pins.start()

    def tearDown(self):
        self.pins.stop(); self.public.stop(); self.extract.stop(); os.chdir(self.cwd); self.tmp.cleanup()

    def prepare(self):
        return steps.prepare(self.ctx,self.supervisor)

    def built(self):
        self.assertTrue(self.prepare()['success'])
        self.assertTrue(steps.typecheck(self.ctx,self.supervisor)['success'])
        self.assertTrue(steps.build(self.ctx,self.supervisor)['success'])

    def test_prepare_uses_fixed_public_node_and_offline_pdfjs(self):
        row = self.prepare()
        self.assertEqual(row['name'],'prepare-offline-assets'); self.assertTrue(row['success'])
        name, argv, options = self.supervisor.calls[0]
        self.assertEqual(argv,[str(steps.TOOLS/'node20'),'scripts/prepare-pdfjs-assets.mjs','--offline','--cache-dir',str(steps.TOOLS/'pdfjs')])
        self.assertNotIn(str(self.root/'deps/node'),argv)
        self.assertEqual(options['cwd'],'source/site')
        self.assertEqual(os.readlink(self.ctx.site/'node_modules'),'../../deps/node_modules')
        self.assertIs(self.ctx.prepare_records['full_cache_integrity_claimed'],False)
        self.assertFalse(self.ctx.compiled.exists())

    def test_real_context_env_passes_real_supervisor_validator_without_spawn(self):
        self.prepare()
        validator = object.__new__(process_runner.Supervisor)
        validator._rootfd = os.open(self.root,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
        try:
            with mock.patch.object(process_runner.subprocess,'Popen',side_effect=AssertionError('no-spawn')):
                for phase in ('prepare','typecheck','build'):
                    environment = steps._environment(self.ctx,phase)
                    actual = validator._environment(environment,'source/site')
                    self.assertEqual(actual['MAIL_PROVIDER'],'dev')
                    self.assertFalse(Path(actual['TMPDIR']).is_absolute())
                    self.assertNotIn('ADMIN_PASSWORD_FILE',actual)
        finally: os.close(validator._rootfd)

    def test_new_runtime_export_contains_only_app_runtime_and_production_packages(self):
        self.built(); phase = steps.export_runtime(self.ctx,self.supervisor)
        self.assertTrue(phase['success']); self.assertEqual(phase['name'],'export-runtime')
        self.assertTrue((self.ctx.compiled/'node_modules/next/dist/bin/next').is_file())
        self.assertTrue((self.ctx.compiled/'node_modules/pg/lib/index.js').is_file())
        for name in ('src','scripts','.env.example','node_modules/typescript','.next/cache','.next/types','.next/trace'):
            self.assertFalse(os.path.lexists(self.ctx.compiled/name),name)
        self.assertEqual(self.ctx.runtime_export['optional_incompatible_skipped'],['node_modules/win-only'])
        self.assertIs(self.ctx.runtime_export['source_stable'],True)
        self.assertIs(self.ctx.runtime_export['qualified'],False)
        self.assertIs(self.ctx.runtime_export['cache_integrity_verified'],False)
        self.assertEqual((self.ctx.site/'src/app.ts').read_bytes(),b'original-source')
        self.assertEqual([call[0] for call in self.supervisor.calls],['prepare-offline-assets','typecheck','build'])

    def test_all_stages_refuse_replay_and_existing_inputs(self):
        self.prepare()
        with self.assertRaisesRegex(steps.RuntimePending,'no_replay'): self.prepare()
        steps.typecheck(self.ctx,self.supervisor)
        with self.assertRaises(steps.RuntimePending): steps.typecheck(self.ctx,self.supervisor)
        steps.build(self.ctx,self.supervisor)
        with self.assertRaises(steps.RuntimePending): steps.build(self.ctx,self.supervisor)
        steps.export_runtime(self.ctx,self.supervisor)
        with self.assertRaises(steps.RuntimePending): steps.export_runtime(self.ctx,self.supervisor)

    def test_unprepared_or_failed_stages_cannot_advance(self):
        with self.assertRaises(steps.RuntimePending): steps.typecheck(self.ctx,self.supervisor)
        self.supervisor.fail='prepare-offline-assets'; self.assertFalse(self.prepare()['success'])
        with self.assertRaises(steps.RuntimePending): steps.typecheck(self.ctx,self.supervisor)
        self.assertEqual(len(self.supervisor.calls),1)

    def test_source_drift_during_child_is_detected_even_when_child_fails(self):
        self.prepare(); self.supervisor.fail='typecheck'
        self.supervisor.mutate=lambda name: put(self.ctx.site/'src/app.ts',b'mutated-source')
        with self.assertRaisesRegex(steps.RuntimePending,'pin_mismatch'): steps.typecheck(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())

    def test_dotenv_or_credentials_added_before_child_are_denied(self):
        self.prepare(); put(self.ctx.site/'.env.local',b'never-read-as-environment')
        with self.assertRaisesRegex(steps.RuntimePending,'dotenv'): steps.typecheck(self.ctx,self.supervisor)
        self.assertEqual(len(self.supervisor.calls),1)

    def test_dependency_link_escape_refused(self):
        self.prepare(); (self.ctx.site/'node_modules').unlink()
        (self.ctx.site/'node_modules').symlink_to('/tmp',target_is_directory=True)
        with self.assertRaises(steps.RuntimePending): steps.typecheck(self.ctx,self.supervisor)
        self.assertEqual(len(self.supervisor.calls),1)

    def test_wrong_tools_or_supervisor_pin_fail_before_extraction(self):
        self.ctx.node=Path('/usr/bin/node')
        with self.assertRaises(steps.RuntimePending): self.prepare()
        self.assertFalse((self.root/'source').exists())
        self.ctx.node=steps.TOOLS/'node20'; self.supervisor.allowed_executables[str(self.ctx.node)]='0'*64
        with self.assertRaises(steps.RuntimePending): self.prepare()
        self.assertFalse((self.root/'source').exists())

    def test_pending_normalization_fails_closed(self):
        self.ctx.dependencies['normalized_archive']['sha256']=None
        with self.assertRaisesRegex(steps.RuntimePending,'normalized'): self.prepare()
        self.assertFalse((self.root/'source').exists())

    def test_dependency_lock_drift_prevents_export_without_requalifying_versions(self):
        self.built(); put(self.root/'deps/package-lock.json',b'{"packages":{}}')
        with self.assertRaisesRegex(steps.RuntimePending,'pin_mismatch'): steps.export_runtime(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())
        self.assertFalse(hasattr(self.ctx,'runtime_export'))

    def test_export_uses_directory_fds_and_never_follows_injected_output_alias(self):
        self.built(); outside=self.root/'outside'; outside.mkdir(mode=0o700)
        original=steps.input_provider._member_parent
        injected=[]
        def inject(root_fd,name):
            if name.startswith('node_modules/') and not injected:
                injected.append(True)
                (self.ctx.compiled/'node_modules').symlink_to(outside,target_is_directory=True)
            return original(root_fd,name)
        with mock.patch.object(steps.input_provider,'_member_parent',side_effect=inject):
            with self.assertRaises(OSError): steps.export_runtime(self.ctx,self.supervisor)
        self.assertEqual(list(outside.iterdir()),[])
        self.assertTrue(self.ctx.compiled.exists())
        self.assertFalse(hasattr(self.ctx,'runtime_export'))

    def test_build_requires_guard_installation_not_merely_no_denial(self):
        self.prepare(); steps.typecheck(self.ctx,self.supervisor); self.supervisor.installed=False
        phase=steps.build(self.ctx,self.supervisor)
        self.assertFalse(phase['success'])
        with self.assertRaises(steps.RuntimePending): steps.export_runtime(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())

    def test_build_denial_prevents_export(self):
        self.prepare(); steps.typecheck(self.ctx,self.supervisor); self.supervisor.denial=True
        phase=steps.build(self.ctx,self.supervisor)
        self.assertFalse(phase['success'])
        with self.assertRaises(steps.RuntimePending): steps.export_runtime(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())

    def test_marker_in_compiled_bytes_rejected_but_excluded_cache_is_not_exported(self):
        self.built(); put(self.ctx.site/'.next/server/app.js',steps.BUILD_MARKERS[0])
        with self.assertRaisesRegex(steps.RuntimePending,'marker'): steps.export_runtime(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())

    def test_missing_next_contract_is_precise_pending_not_stub_success(self):
        self.built(); (self.ctx.site/'.next/required-server-files.json').unlink()
        with self.assertRaisesRegex(steps.RuntimePending,'next_required_server_files_contract_missing'): steps.export_runtime(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())
        self.assertFalse(hasattr(self.ctx,'runtime_export'))

    def test_missing_required_next_file_refuses_output(self):
        self.built(); put(self.ctx.site/'.next/required-server-files.json',raw({'files':['.next/missing-file']}))
        with self.assertRaisesRegex(steps.RuntimePending,'required_next_server_file_omitted'): steps.export_runtime(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())

    def test_compatible_missing_or_version_mismatched_package_refused(self):
        self.built(); (self.root/'deps/node_modules/pg/package.json').unlink()
        with self.assertRaises((steps.RuntimePending,FileNotFoundError)): steps.export_runtime(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())

    def test_runtime_directory_symlink_escape_refused(self):
        self.built(); (self.root/'deps/node_modules/pg/unsafe').symlink_to('/tmp',target_is_directory=True)
        with self.assertRaisesRegex(steps.RuntimePending,'directory_symlink'): steps.export_runtime(self.ctx,self.supervisor)
        self.assertFalse(self.ctx.compiled.exists())

    def test_export_preserves_partial_directory_and_refuses_reinitialization(self):
        self.built(); original=steps._read; counter=[]
        def fail(path,*args,**kwargs):
            if self.ctx.compiled.exists() and Path(path).is_relative_to(self.root/'deps'):
                counter.append(path)
                if len(counter)==1: raise OSError('fixture-copy-failure')
            return original(path,*args,**kwargs)
        with mock.patch.object(steps,'_read',side_effect=fail):
            with self.assertRaises(OSError): steps.export_runtime(self.ctx,self.supervisor)
        self.assertTrue(self.ctx.compiled.exists())
        self.assertFalse(hasattr(self.ctx,'runtime_export'))
        with self.assertRaises(steps.RuntimePending): steps.export_runtime(self.ctx,self.supervisor)


if __name__=='__main__': unittest.main()
