"""Composition tests with REAL environment validation, NEVER child execution.

All files are fictitious and private under the project TMPDIR. No Node, driver,
application, PostgreSQL, browser, historical executor or host probe is run.
"""
import copy
import hashlib
import json
import os
from pathlib import Path
import tempfile
import types
import unittest
from unittest import mock

import artifact_policy
import driver_contract
import driver
import process_runner
import qa_adapter
import resource_plan

HERE = Path(__file__).resolve().parent
TMPROOT = HERE.parent / 'test-state/tmp'
TOOLS = Path(driver_contract.TOOLS)


class EnvironmentValidatedWithoutSpawn(RuntimeError):
    pass


class DriverCompositionTests(unittest.TestCase):
    def setUp(self):
        TMPROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='driver-composition-', dir=TMPROOT)
        self.root = Path(self.temp.name)
        for name in ('e', 't', 'c', 'g', 'r', 'outbox', 'source/site', 'compiled'):
            (self.root / name).mkdir(mode=0o700, parents=True, exist_ok=True)
        self.no_spawn = mock.patch.object(process_runner.subprocess, 'Popen', side_effect=AssertionError('integration test must not spawn'))
        self.spawn = self.no_spawn.start()
        self.supervisor = process_runner.Supervisor(self.root, {str(TOOLS / 'node20'): 'a' * 64})

    def tearDown(self):
        self.supervisor.close()
        self.spawn.assert_not_called()
        self.no_spawn.stop()
        self.temp.cleanup()

    def env_for(self, cwd, phase):
        # A trusted test context only. The real driver env factory is parent-
        # owned and will be composed with these same actual validation gates.
        relative = os.path.relpath(self.root, cwd)
        def directory(name):
            return os.path.normpath(os.path.join(relative, name))
        return {'HOME': directory('e'), 'TMPDIR': directory('t'), 'TMP': directory('t'), 'TEMP': directory('t'),
                'XDG_CACHE_HOME': directory('c'), 'XDG_CONFIG_HOME': directory('g'), 'XDG_RUNTIME_DIR': directory('r'),
                'SECRETS_DIR': directory('e'), 'PETICAO_CONFIG_DIR': directory('e'), 'CREDENTIALS_DIRECTORY': directory('e'),
                'GEO_DIR': directory('e'), 'MAIL_OUTBOX_DIR': directory('outbox'),
                'NODE_ENV': 'test' if phase == 'qa' else 'production', 'MAIL_PROVIDER': 'dev', 'MAIL_PROVIDERS': 'dev',
                'CRON_SECRET': '', 'WHATSAPP_ENABLED': '0', 'PYTHONDONTWRITEBYTECODE': '1',
                'HASH_PEPPER': 'PROFILE-FIXTURE-ONLY-NOT-PRODUCTION-v1', 'ADMIN_PASSWORD': 'ProfileFixtureOnly-v1',
                'DATABASE_URL': 'postgres://build:build@127.0.0.1:1/build',
                'NODE_OPTIONS': '--require=' + str(TOOLS) + '/qa/network-guard.cjs --max-old-space-size=3072'}

    def driver_context(self, kind='admin-qa-v1'):
        inventory = {name: {'sha256': hashlib.sha256((HERE / name).read_bytes()).hexdigest(), 'bytes': (HERE / name).stat().st_size} for name in qa_adapter.QA_FILES}
        policy = {'dependencies_ref': driver_contract.dependencies_reference(),
                  'plans': {name: driver_contract.plan(name) for name in driver_contract.KINDS},
                  'qa_inventory': inventory}
        return driver.Context(self.root, kind, policy, driver_contract)

    def test_real_driver_context_env_matches_real_supervisor_for_each_profile(self):
        for kind in driver_contract.KINDS:
            context = self.driver_context(kind)
            for cwd in ('.', 'source/site', 'compiled'):
                for phase in ('prepare', 'typecheck', 'build', 'qa'):
                    with self.subTest(kind=kind, cwd=cwd, phase=phase):
                        absolute = self.root if cwd == '.' else self.root / cwd
                        environment = context.env_for(absolute, phase)
                        before = dict(environment)
                        checked = self.supervisor._environment(environment, cwd)
                        self.assertEqual(environment, before)
                        self.assertEqual(checked['MAIL_PROVIDER'], 'dev')
                        self.assertEqual(checked['MAIL_PROVIDERS'], 'dev')
                        self.assertEqual(checked['CRON_SECRET'], '')
                        self.assertEqual(checked['WHATSAPP_ENABLED'], '0')
                        prefix = '--require=' if phase == 'qa' else '--import='
                        filename = 'network-guard.cjs' if phase == 'qa' else 'build-guard.mjs'
                        self.assertEqual(checked['NODE_OPTIONS'], prefix + str(TOOLS / 'qa' / filename) + ' --max-old-space-size=' + str(context.resources['node_heap_mib']))
                        for key in process_runner._RELATIVE_ENV & set(environment):
                            self.assertEqual(checked[key], environment[key])
                            self.assertFalse(Path(checked[key]).is_absolute())
        self.assertFalse((self.root / 'driver-intent.json').exists())
        self.assertEqual(self.supervisor._handles, {})

    def test_qa_adapter_environment_passes_real_supervisor_gate_without_spawn(self):
        seen = {}
        context = self.driver_context()
        def stop_at_environment(name, argv, **options):
            seen.update(name=name, argv=argv, options=options,
                        checked=self.supervisor._environment(options['env'], options['cwd']))
            raise EnvironmentValidatedWithoutSpawn
        with mock.patch.object(qa_adapter, '_verify_context', return_value=self.root), mock.patch.object(qa_adapter, 'measure_ipc', return_value={}), mock.patch.object(self.supervisor, 'run', side_effect=stop_at_environment):
            with self.assertRaises(EnvironmentValidatedWithoutSpawn):
                qa_adapter.run_qa(context, self.supervisor)
        self.assertEqual(seen['name'], 'qa100')
        self.assertEqual(seen['argv'], [str(TOOLS / 'node20'), str(TOOLS / 'qa/qa-driver.mjs')])
        self.assertEqual(seen['options']['cwd'], '.')
        self.assertEqual(seen['options']['expected_checks'], 100)
        self.assertTrue(callable(seen['options']['observed_checks']))
        checked = seen['checked']
        for key, value in {'NODE': str(TOOLS / 'node20'), 'PYTHON': str(TOOLS / 'python312/bin/python3.12'),
                           'CHROMIUM': str(TOOLS / 'chromium/chrome-linux64/chrome'), 'QA_ROOT': 'private-qa',
                           'WHEELS_ROOT': str(TOOLS / 'python-wheels/site'), 'PROFILE_TOOLS_ROOT': str(TOOLS),
                           'PLAYWRIGHT_NODEJS_PATH': str(TOOLS / 'node20')}.items():
            self.assertEqual(checked[key], value)
        for key in ('HOME', 'TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR'):
            self.assertFalse(Path(checked[key]).is_absolute())
            self.assertTrue(checked[key].startswith('private-qa/'))
        self.assertEqual(self.supervisor._handles, {})
        self.assertEqual(self.supervisor._used, set())

    def test_relative_environment_is_preserved_for_source_and_compiled_cwd(self):
        for cwd in ('.', 'source/site', 'compiled'):
            with self.subTest(cwd=cwd):
                absolute = self.root if cwd == '.' else self.root / cwd
                environment = self.env_for(absolute, 'qa')
                before = dict(environment)
                checked = self.supervisor._environment(environment, cwd)
                for key in process_runner._RELATIVE_ENV & set(environment):
                    self.assertEqual(checked[key], environment[key])
                    self.assertFalse(Path(checked[key]).is_absolute())
                self.assertEqual(environment, before)
        self.assertEqual(self.supervisor._environment({'TMPDIR': '../../t', 'HOME': '../../e'}, 'source/site')['TMPDIR'], '../../t')

    def test_fixed_guards_and_all_official_aliases_are_accepted(self):
        aliases = {'PROFILE_TOOLS_ROOT': str(TOOLS), 'PROFILE_NODE': str(TOOLS / 'node20'),
                   'PROFILE_PYTHON': str(TOOLS / 'python312/bin/python3.12'),
                   'PROFILE_CHROMIUM': str(TOOLS / 'chromium/chrome-linux64/chrome'),
                   'PROFILE_QA_ROOT': str(TOOLS / 'qa'), 'PROFILE_WHEELS_ROOT': str(TOOLS / 'python-wheels/site'),
                   'PGPORT': '28451', 'APP_PORT': '28452'}
        self.assertEqual({k: self.supervisor._environment(aliases, '.')[k] for k in aliases}, aliases)
        for heap in ('3072', '6144'):
            for flag, filename in (('--require=', 'network-guard.cjs'), ('--import=', 'build-guard.mjs')):
                options = flag + str(TOOLS / 'qa' / filename) + ' --max-old-space-size=' + heap
                self.assertEqual(self.supervisor._environment({'NODE_OPTIONS': options}, '.')['NODE_OPTIONS'], options)
        self.assertEqual((HERE / 'qa/build-guard.mjs').name, 'build-guard.mjs')
        self.assertIn('qa/build-guard.mjs', qa_adapter.QA_FILES)
        self.assertIn('qa/network-guard.cjs', qa_adapter.QA_FILES)

    def test_environment_gate_rejects_path_and_secret_or_network_expansion(self):
        invalid = ({'HOME': '/home/barre'}, {'TMPDIR': '/tmp'}, {'TMPDIR': '../escape'},
                   {'NODE': '/usr/bin/node'}, {'PYTHON': '/usr/bin/python3'}, {'CHROMIUM': '/usr/bin/chromium'},
                   {'QA_ROOT': '/mnt/apps/peticao-final/.qt1'}, {'PGPORT': '5432'}, {'APP_PORT': '3184'},
                   {'DATABASE_URL': 'postgres://fictitious@192.0.2.1/example'}, {'MAIL_PROVIDER': 'smtp'},
                   {'WHATSAPP_ENABLED': '1'}, {'CRON_SECRET': 'fictitious-but-nonempty'},
                   {'NODE_OPTIONS': '--require=/tmp/guard.cjs --max-old-space-size=3072'},
                   {'NODE_OPTIONS': '--import=' + str(TOOLS / 'qa/build-guard.mjs') + ' --eval=fictitious'},
                   {'PYTHONPATH': '/home/barre/.local'}, {'LD_PRELOAD': '/fictitious.so'},
                   {'HOME': None}, {'NEXT_BUILD_CPUS': '14'})
        for value in invalid:
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.supervisor._environment(value, '.')
        (self.root / 'linked-home').symlink_to(self.root / 'e', target_is_directory=True)
        with self.assertRaises(OSError):
            self.supervisor._environment({'HOME': 'linked-home'}, '.')

    def test_plan_exposes_qa100_once_and_fixed_internal_step_metadata(self):
        plan = driver_contract.plan('admin-qa-v1')
        self.assertEqual(plan['phases'], ['verify-inputs', 'prepare-offline-assets', 'typecheck', 'build', 'export-runtime', 'qa100', 'drain'])
        self.assertEqual(plan['phases'].count('qa100'), 1)
        self.assertEqual(plan['qa_steps'], ['postgres-init', 'backend43', 'fixture-seed', 'runtime-start', 'http7', 'browser40', 'maps2', 'http-reset8', 'fixture-refresh'])
        self.assertEqual(plan['qa_counts'], qa_adapter.COUNTS)
        self.assertEqual(sum(plan['qa_counts'].values()), 100)
        self.assertLess(plan['qa_steps'].index('maps2'), plan['qa_steps'].index('http-reset8'))
        self.assertLess(plan['qa_steps'].index('browser40'), plan['qa_steps'].index('http-reset8'))
        self.assertEqual(plan['layout']['compiled'], 'compiled')
        self.assertEqual(plan['layout']['relative_to'], 'trusted_StateDirectory_namespace_alias')
        self.assertIs(plan['layout']['old_paths_or_units_reused'], False)
        for name in ('admin-typecheck-v1', 'admin-build-v1'):
            value = driver_contract.plan(name)
            self.assertNotIn('qa100', value['phases'])
            self.assertIsNone(value['qa_steps'])
            self.assertIsNone(value['qa_counts'])

    def test_plan_environment_policy_remains_source_only_and_no_external_effects(self):
        for profile in driver_contract.KINDS:
            plan = driver_contract.plan(profile)
            self.assertEqual(plan['qualification'], {'qualified': False, 'operationalReady': False, 'qualification_manifest_event': None})
            for flag in ('inherit', 'dotenv_allowed', 'credentials_allowed', 'whatsapp', 'cron', 'external_network'):
                self.assertIs(plan['environment_policy'][flag], False)
            self.assertIs(plan['environment_policy']['loopback_fixtures_only'], True)
            self.assertEqual(plan['artifact_policy'], artifact_policy.policy())
            self.assertIs(plan['historical_budget_is_measured_minimum'], False)
        self.assertIs(process_runner.QUALIFIED, False)
        self.assertIs(resource_plan.QUALIFIED, False)
        self.assertIs(resource_plan.DISPATCH_ENABLED, False)
        self.assertIs(resource_plan.INSTALLS_OR_RUNS_HOST, False)

    def test_source_closure_metadata_does_not_qualify_pending_python_runtime(self):
        inventory = {name: {'sha256': hashlib.sha256((HERE / name).read_bytes()).hexdigest(), 'bytes': (HERE / name).stat().st_size} for name in qa_adapter.QA_FILES}
        self.assertEqual(len(inventory), 14)
        sha = hashlib.sha256(driver_contract.canonical(inventory).encode()).hexdigest()
        self.assertRegex(sha, '[a-f0-9]{64}')
        dependencies = driver_contract.dependencies_reference()
        dependencies['qa_closure_sha256'] = sha
        pending = driver_contract.validate_dependencies(dependencies)
        self.assertTrue(pending)
        with self.assertRaises(PermissionError):
            driver_contract.validate_dependencies(dependencies, execution=True)
        runtime = json.loads((HERE / 'qa/python-runtime.json').read_text())
        self.assertEqual(runtime['files'], {})
        with self.assertRaisesRegex(qa_adapter.QAPending, 'inventory_pending'):
            qa_adapter._verify_python_runtime(runtime)
        plan = driver_contract.plan('admin-qa-v1', dependencies=dependencies)
        self.assertIs(plan['qualification']['qualified'], False)
        self.assertTrue(plan['pending_pins'])

    def test_missing_native_pins_and_long_ipc_never_reach_real_spawn(self):
        context = types.SimpleNamespace(root=self.root, site=self.root / 'source/site', compiled=self.root / 'compiled',
                                        tools=TOOLS, node=TOOLS / 'node20', python=TOOLS / 'python312/bin/python3.12',
                                        chromium=TOOLS / 'chromium/chrome-linux64/chrome', env_for=self.env_for,
                                        qa_inventory={}, qa_closure_sha256=None)
        with self.assertRaisesRegex(qa_adapter.QAPending, 'complete_pinned_qa_closure'):
            qa_adapter.run_qa(context, self.supervisor)
        self.assertEqual(self.supervisor._used, set())
        with self.assertRaisesRegex(qa_adapter.QAPending, 'ipc_path_budget'):
            qa_adapter.measure_ipc(self.root)
        self.assertFalse((self.root / 'private-qa').exists())


if __name__ == '__main__':
    unittest.main()
