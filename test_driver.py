"""Fictitious fixed-recipe orchestration only: no workload or host operations."""
import copy
import json
import os
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

import artifact_policy as a
import driver as d
import driver_contract as c

TMP = Path('/mnt/apps/peticao-final/_ops/apoio-infra-paralela-20261114/civo-real-profile-driver-20261115/test-state/tmp')


class Driver(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(dir=TMP, prefix='orchestrator-')
        self.root = Path(self.temp.name)
        self.deps = c.dependencies_reference()
        self.policy = {'dependencies_ref': self.deps, 'plans': {k: c.plan(k) for k in c.KINDS},
                       'qa_inventory': {}, 'toolchain_inventory': {'files': {'node20': {'sha256': 'a'*64, 'bytes': 10}}}}
        self.calls = []
        def step(name):
            def run(ctx, supervisor):
                self.calls.append(name)
                return d.phase(name)
            return run
        self.steps = SimpleNamespace(prepare=step('prepare-offline-assets'), typecheck=step('typecheck'),
            build=step('build'), export_runtime=step('export-runtime'))
        self.supervisor = SimpleNamespace(drain=lambda **kw: {'version':1,'scope':'driver_owned_children',
            'tracked_processes':0,'remaining_owned_processes':0,'stop_requested':False,'all_exited':True})
        self.modules = {'artifact_policy': a, 'driver_contract': c, 'runtime_steps': self.steps,
                        'qa_adapter': SimpleNamespace(run_qa=self.qa)}
        a.prepare_artifacts(self.root / 'artifacts')

    def tearDown(self):
        self.temp.cleanup()

    def ctx(self, kind='admin-build-v1'):
        ctx = d.Context(self.root, kind, copy.deepcopy(self.policy), c)
        # Explicit fictitious witness for pure orchestration; no real input IO.
        ctx.input_verification = {'files':2, 'bytes':30}
        return ctx

    def qa(self, ctx, supervisor):
        self.calls.append('qa100')
        row = d.phase('qa100'); row.update(expected_checks=100, observed_checks=100)
        return {'phases':[row], 'summary':{'version':1,'counts':dict(c.QA_COUNTS), 'passed':True,
            'page_errors':0,'blocked_writes':0,'fixture_only':True},
            'network':{'version':1,'mode':'offline-loopback-fixtures','external_allowed':False,
                'attempts_denied':0,'unexpected_attempts':0,'fixture_pg_loopback':True,'fixture_http_loopback':True}}

    def test_template_cannot_bootstrap_or_open_policy(self):
        with mock.patch.object(os, 'open', side_effect=AssertionError('must not open')):
            with self.assertRaisesRegex(PermissionError, 'unfrozen'):
                d._bootstrap_bytes('/not/read', '0'*64)
        with self.assertRaises(PermissionError):
            d.bootstrap()

    def test_missing_input_witness_cannot_execute_or_emit_success(self):
        ctx = self.ctx(); ctx.input_verification = None
        with self.assertRaises(PermissionError): d.execute(ctx, self.modules, self.supervisor)
        self.assertEqual(self.calls, [])
        self.assertEqual(list((self.root/'artifacts').iterdir()), [])

    def test_build_fixed_order_and_only_sanitized_receipts_exported(self):
        result = d.execute(self.ctx(), self.modules, self.supervisor)
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(self.calls, ['prepare-offline-assets','typecheck','build','export-runtime'])
        inventory = a.inspect_artifacts(self.root/'artifacts')
        names = {item['name'] for item in inventory['files']}
        self.assertEqual(names, {'profile-result.json','phase-results.json','process-drain-proof.json','integrity-proof.json','sanitized-build.log'})
        self.assertFalse(any(name.endswith('.tar') or name == '.env' for name in names))
        self.assertEqual(result['phase_count'], 6)
        self.assertNotIn('qualified', result)
        report = json.loads((self.root/'result.json').read_text())
        self.assertEqual(report, {'protocol':1,'profile':'admin-build-v1','exit_code':0})
        self.assertEqual((self.root/'result.json').stat().st_mode & 0o777, 0o600)
        self.assertNotIn('result.json', names)

    def test_typecheck_never_calls_build_or_qa(self):
        result = d.execute(self.ctx('admin-typecheck-v1'), self.modules, self.supervisor)
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(self.calls, ['prepare-offline-assets','typecheck'])

    def test_qa_has_new_build_before_one_exact100_phase(self):
        result = d.execute(self.ctx('admin-qa-v1'), self.modules, self.supervisor)
        self.assertEqual(result['status'], 'passed')
        self.assertEqual(self.calls[-2:], ['export-runtime','qa100'])
        self.assertEqual(len(a.inspect_artifacts(self.root/'artifacts')['files']), 7)

    def test_first_failure_no_retry_and_no_next_stage(self):
        def fail(ctx, supervisor):
            self.calls.append('typecheck'); return d.phase('typecheck', False)
        self.steps.typecheck = fail
        result = d.execute(self.ctx(), self.modules, self.supervisor)
        self.assertEqual(result['failed_phase'], 'typecheck')
        self.assertEqual(result['exit_code'], 1)
        self.assertEqual(json.loads((self.root/'result.json').read_text())['exit_code'], 1)
        self.assertEqual(self.calls, ['prepare-offline-assets','typecheck'])

    def test_untrusted_exception_content_not_exported(self):
        def fail(*args):
            raise RuntimeError('fictitious-private-value-must-not-escape')
        self.steps.prepare = fail
        result = d.execute(self.ctx(), self.modules, self.supervisor)
        self.assertEqual(result['failed_phase'], 'prepare-offline-assets')
        for path in (self.root/'artifacts').iterdir():
            self.assertNotIn(b'fictitious-private-value', path.read_bytes())

    def test_wrong_phase_name_cannot_supply_pass(self):
        self.steps.prepare = lambda *args: d.phase('unexpected')
        result = d.execute(self.ctx(), self.modules, self.supervisor)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['failed_phase'], 'prepare-offline-assets')

    def test_incomplete_direct_child_drain_fails_profile(self):
        self.supervisor.drain = lambda **kw: {'version':1,'scope':'driver_owned_children',
            'tracked_processes':1,'remaining_owned_processes':1,'stop_requested':True,'all_exited':False}
        result = d.execute(self.ctx(), self.modules, self.supervisor)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(result['failed_phase'], 'drain')

    def test_qa_unexpected_network_cannot_pass(self):
        base = self.qa
        def unexpected(*args):
            value = base(*args); value['network'].update(attempts_denied=1, unexpected_attempts=1); return value
        self.modules['qa_adapter'].run_qa = unexpected
        result = d.execute(self.ctx('admin-qa-v1'), self.modules, self.supervisor)
        self.assertEqual(result['failed_phase'], 'qa100')
        self.assertEqual(result['status'], 'failed')

    def test_new_intent_is_exclusive_and_no_reinitialization(self):
        ctx = self.ctx(); ctx.initialize()
        with self.assertRaises(FileExistsError): ctx.initialize()
        self.assertEqual((self.root/'driver-intent.json').stat().st_mode & 0o777, 0o600)

    def test_context_environment_is_fresh_relative_and_fixture_only(self):
        ctx = self.ctx(); ctx.initialize()
        env = ctx.env_for(ctx.site, 'build')
        self.assertEqual(env['TMPDIR'], '../../t')
        self.assertEqual(env['MAIL_PROVIDER'], 'dev')
        self.assertEqual(env['DATABASE_URL'], 'postgres://build:build@127.0.0.1:1/build')
        self.assertNotIn('LD_PRELOAD', env)
        with self.assertRaises(ValueError): ctx.env_for(self.root.parent, 'build')

    def test_duplicate_policy_keys_refused(self):
        with self.assertRaises(ValueError):
            json.loads('{"version":1,"version":2}', object_pairs_hook=d._unique_pairs)


if __name__ == '__main__':
    unittest.main()
