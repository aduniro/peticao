"""Source-only QA adapter tests: no app, PostgreSQL, browser or historical run."""
import ast
import copy
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import types
import unittest
from unittest import mock

import qa_adapter as qa

HERE = Path(__file__).parent
TMPROOT = HERE.parent / 'test-state/tmp'


def write(path, value):
    path.write_text(json.dumps(value), encoding='utf-8')
    path.chmod(0o600)


def report():
    return {'version': 1, 'counts': dict(qa.COUNTS), 'passed': True, 'page_errors': 0, 'blocked_writes': 0,
            'fixture_only': True, 'refreshed': True,
            'cleanup': {'runtime_stopped': True, 'forced': False, 'app_stopped': True, 'pg_stopped': True}}


class DummySupervisor:
    def __init__(self, root, value=None, code=0):
        self.root, self.value, self.code = root, value, code
        self.calls = []
        self.observed = None

    def run(self, name, argv, **kwargs):
        self.calls.append((name, argv, kwargs))
        if self.value is not None:
            write(self.root / 'private-qa/QA-SUMMARY.json', self.value)
        observed = 0
        if self.code == 0:
            try:
                observed = kwargs['observed_checks']()
            except qa.QAPending:
                pass
        self.observed = observed
        return {'name': name, 'exit_code': self.code, 'signal': None, 'duration_ms': 1,
                'expected_checks': kwargs['expected_checks'], 'observed_checks': observed,
                'success': self.code == 0 and observed == kwargs['expected_checks']}

    def log_path(self, name):
        return self.root / '.driver-process-logs' / (name + '.log')


class QAAdapterTests(unittest.TestCase):
    def setUp(self):
        TMPROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(prefix='qa-adapter-', dir=TMPROOT)
        self.root = Path(self.temp.name)
        (self.root / 'source/site').mkdir(mode=0o700, parents=True)
        (self.root / 'compiled').mkdir(mode=0o700)
        self.env = {'NODE_OPTIONS': '--require=' + str(qa.TOOLS) + '/qa/network-guard.cjs --max-old-space-size=3072'}
        self.ctx = types.SimpleNamespace(root=self.root, site=self.root / 'source/site', compiled=self.root / 'compiled',
                                         tools=qa.TOOLS, node=qa.TOOLS / 'node20', python=qa.TOOLS / 'python312/bin/python3.12',
                                         chromium=qa.TOOLS / 'chromium/chrome-linux64/chrome',
                                         env_for=lambda cwd, phase: dict(self.env), qa_inventory={}, qa_closure_sha256=None)

    def tearDown(self):
        self.temp.cleanup()

    def mocked_run(self, supervisor):
        with mock.patch.object(qa, '_verify_context', return_value=self.root), mock.patch.object(qa, 'measure_ipc', return_value={}):
            return qa.run_qa(self.ctx, supervisor)

    def test_missing_closure_never_starts_supervisor_or_creates_private_state(self):
        supervisor = DummySupervisor(self.root, report())
        with self.assertRaisesRegex(qa.QAPending, 'complete_pinned_qa_closure'):
            qa.run_qa(self.ctx, supervisor)
        self.assertEqual(supervisor.calls, [])
        self.assertFalse((self.root / 'private-qa').exists())

    def test_fixed_tool_paths_and_same_job_export_are_required(self):
        self.ctx.node = Path('/usr/bin/node')
        with self.assertRaisesRegex(qa.QAPending, 'fixed_pinned_qa_tool'):
            qa._verify_context(self.ctx)
        self.ctx.node = qa.TOOLS / 'node20'
        self.ctx.compiled = self.root / 'historical-export'
        with self.assertRaisesRegex(qa.QAPending, 'same_job_source'):
            qa._verify_context(self.ctx)

    def test_source_python_runtime_inventory_is_explicitly_pending(self):
        value = json.loads((HERE / 'qa/python-runtime.json').read_text())
        self.assertEqual(value['files'], {})
        with self.assertRaisesRegex(qa.QAPending, 'inventory_pending'):
            qa._verify_python_runtime(value)
        spec = importlib.util.spec_from_file_location('qa_browser_bootstrap', HERE / 'qa/browser-bootstrap.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        with self.assertRaisesRegex(PermissionError, 'inventory_pending'):
            module.validate_runtime(value)

    def test_ipc_checks_relative_and_absolute_lengths_before_execution(self):
        measured = qa.measure_ipc(Path('/j'))
        self.assertEqual(measured['tmp']['limit'], 108)
        self.assertLess(measured['tmp']['absolute_bytes'], 108)
        with self.assertRaisesRegex(qa.QAPending, 'ipc_path_budget'):
            qa.measure_ipc(Path('/' + 'x' * 90))
        with self.assertRaisesRegex(qa.QAPending, 'relative_private'):
            qa.measure_ipc(Path('/j'), '/tmp')
        with self.assertRaises(qa.QAPending):
            qa.measure_ipc(Path('/j'), '../escape')
        supervisor = DummySupervisor(self.root, report())
        with mock.patch.object(qa, '_verify_context', return_value=self.root), self.assertRaisesRegex(qa.QAPending, 'ipc_path_budget'):
            qa.run_qa(self.ctx, supervisor)
        self.assertEqual(supervisor.calls, [])

    def test_mocked_success_correlates_actual_report_not_declared_count(self):
        supervisor = DummySupervisor(self.root, report())
        value = self.mocked_run(supervisor)
        self.assertEqual(supervisor.observed, 100)
        self.assertTrue(value['phases'][0]['success'])
        self.assertEqual(value['summary']['counts'], qa.COUNTS)
        self.assertEqual(set(value['summary']), {'version', 'counts', 'passed', 'page_errors', 'blocked_writes', 'fixture_only'})
        name, argv, options = supervisor.calls[0]
        self.assertEqual(name, 'qa100')
        self.assertEqual(argv, [str(qa.TOOLS / 'node20'), str(qa.TOOLS / 'qa/qa-driver.mjs')])
        self.assertEqual(options['cwd'], '.')
        self.assertEqual(options['timeout'], 1200)
        self.assertEqual(options['expected_checks'], 100)
        for key in ('HOME', 'TMPDIR', 'TMP', 'TEMP', 'XDG_CACHE_HOME', 'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR'):
            self.assertFalse(Path(options['env'][key]).is_absolute())
            self.assertTrue(options['env'][key].startswith('private-qa/'))
        self.assertNotIn('QA_ROOT', self.env)  # env_for mapping is not mutated.
        self.assertEqual(value['log_path'], supervisor.log_path('qa100'))

    def test_wrong_counts_missing_refresh_and_forced_drain_cannot_return_100(self):
        for case in ('counts', 'refresh', 'forced', 'pg', 'page_error', 'blocked_write', 'typed_bool', 'extra'):
            with self.subTest(case=case):
                value = report()
                if case == 'counts':
                    value['counts']['browser'] = 39
                elif case == 'refresh':
                    value['refreshed'] = False
                elif case == 'forced':
                    value['cleanup']['forced'] = True
                elif case == 'pg':
                    value['cleanup']['pg_stopped'] = False
                elif case == 'page_error':
                    value['page_errors'] = 1
                elif case == 'blocked_write':
                    value['blocked_writes'] = 1
                elif case == 'typed_bool':
                    value['counts']['maps'] = True
                else:
                    value['raw_cookie'] = 'fictitious-secret-never-export'
                private = self.root / 'private-qa'
                if private.exists():
                    shutil.rmtree(private)
                supervisor = DummySupervisor(self.root, value)
                result = self.mocked_run(supervisor)
                self.assertEqual(supervisor.observed, 0)
                self.assertFalse(result['phases'][0]['success'])
                self.assertFalse(result['summary']['passed'])

    def test_missing_report_and_failed_child_never_fabricate_pass(self):
        supervisor = DummySupervisor(self.root, code=1)
        result = self.mocked_run(supervisor)
        self.assertEqual(supervisor.observed, 0)
        self.assertFalse(result['summary']['passed'])
        self.assertEqual(sum(result['summary']['counts'].values()), 0)
        self.assertFalse(result['network']['fixture_pg_loopback'])

    def test_existing_attempt_and_missing_guard_refuse_without_launch(self):
        supervisor = DummySupervisor(self.root, report())
        self.mocked_run(supervisor)
        with self.assertRaises(FileExistsError):
            self.mocked_run(supervisor)
        self.assertEqual(len(supervisor.calls), 1)
        shutil.rmtree(self.root / 'private-qa')
        self.env.clear()
        with self.assertRaisesRegex(qa.QAPending, 'network_guard'):
            self.mocked_run(supervisor)
        self.assertEqual(len(supervisor.calls), 1)

    def test_private_report_permissions_duplicate_keys_and_links_are_rejected(self):
        private = qa._prepare(self.root)
        path = private / 'QA-SUMMARY.json'
        write(path, report())
        path.chmod(0o644)
        with self.assertRaises(qa.QAPending):
            qa._summary(private)
        path.chmod(0o600)
        path.write_text('{"version":1,"version":1}')
        with self.assertRaises(qa.QAPending):
            qa._summary(private)
        path.unlink()
        target = self.root / 'elsewhere'
        write(target, report())
        path.symlink_to(target)
        with self.assertRaises(qa.QAPending):
            qa._summary(private)

    def test_network_summary_is_bounded_constant_metadata(self):
        private = qa._prepare(self.root)
        path = private / 'network-denials.jsonl'
        path.write_bytes(b'{"kind":"dns"}\n{"kind":"fetch"}\n')
        path.chmod(0o600)
        value = qa._network(private, True)
        self.assertEqual(value['attempts_denied'], 2)
        self.assertIs(value['external_allowed'], False)
        path.write_bytes(b'{"kind":"dns","token":"fictitious"}\n')
        with self.assertRaises(qa.QAPending):
            qa._network(private, True)

    def test_all_qa_helpers_are_new_fixed_paths_and_import_safe_python(self):
        actual = {'qa/' + item.name for item in (HERE / 'qa').iterdir() if item.is_file()}
        self.assertEqual(actual, qa.QA_FILES)
        for item in (HERE / 'qa').iterdir():
            if item.suffix in {'.py', '.mjs', '.cjs', '.ts'}:
                text = item.read_text()
                for forbidden in ('3184', '54524', '/mnt/apps/peticao-final/.qt1', 'systemd-run', 'runuser'):
                    self.assertNotIn(forbidden, text, str(item))
            if item.suffix == '.py':
                tree = ast.parse(item.read_text())
                # Only definitions/imports/literal constants and guarded main
                # exist at top level; argparse/Playwright remain inside main.
                for node in tree.body:
                    if isinstance(node, ast.Expr):
                        self.assertIsInstance(node.value, ast.Constant)
        runtime = (HERE / 'qa/qa-runtime.mjs').read_text()
        self.assertNotIn('EmbeddedPostgres', runtime)
        self.assertNotIn('embedded-postgres', runtime)
        self.assertIn('unix_socket_directories=', runtime)
        self.assertIn("'-h','127.0.0.1'", runtime)
        self.assertIn('28451', (HERE / 'qa/common.mjs').read_text())
        driver = (HERE / 'qa/qa-driver.mjs').read_text()
        self.assertLess(driver.index("'/browser-bootstrap.py','browser40'"), driver.index("'/http-regression.mjs'"))
        self.assertLess(driver.index("'/browser-bootstrap.py','maps2'"), driver.index("'/http-regression.mjs'"))
        self.assertIn("'-I','-S','-B'", driver)

    def test_complete_toy_inventory_is_checked_and_helper_or_wheel_mutation_fails(self):
        # All pins here are fictitious local fixtures, never a qualified runtime.
        tools = self.root / 'toy-tools'
        (tools / 'qa').mkdir(parents=True)
        site = tools / 'python-wheels/site'
        site.mkdir(parents=True)
        (site / 'playwright').mkdir()
        file = site / 'playwright/__init__.py'
        file.write_bytes(b'')  # Legitimate inventories may contain empty modules.
        file.chmod(0o600)
        pending = json.loads((HERE / 'qa/python-runtime.json').read_text())
        wheels = []
        for row in pending['source_wheels']:
            raw = ('fictitious wheel ' + row['name']).encode()
            path = tools / 'python-wheels' / row['name']
            path.write_bytes(raw)
            path.chmod(0o600)
            wheels.append({'name': row['name'], 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)})
        runtime = {'version': 1, 'site_root': str(site), 'source_wheels': wheels,
                   'files': {'playwright/__init__.py': {'sha256': hashlib.sha256(b'').hexdigest(), 'bytes': 0}}}
        for name in qa.QA_FILES:
            path = tools / name
            path.write_bytes((HERE / name).read_bytes())
            path.chmod(0o600)
        write(tools / 'qa/python-runtime.json', runtime)
        inventory = {name: {'sha256': hashlib.sha256((tools / name).read_bytes()).hexdigest(), 'bytes': (tools / name).stat().st_size} for name in qa.QA_FILES}
        ctx = copy.copy(self.ctx)
        ctx.tools, ctx.node, ctx.python, ctx.chromium = tools, tools / 'node20', tools / 'python312/bin/python3.12', tools / 'chromium/chrome-linux64/chrome'
        ctx.qa_inventory = inventory
        ctx.qa_closure_sha256 = hashlib.sha256(qa._canonical(inventory).encode()).hexdigest()
        original_read, original_chain = qa._read, qa._chain
        def read(path, **kwargs):
            kwargs.update(uid=os.geteuid(), private=True)
            return original_read(path, **kwargs)
        with mock.patch.object(qa, 'TOOLS', tools), mock.patch.object(qa, '_chain', side_effect=lambda path, root_controlled=False: original_chain(path)), mock.patch.object(qa, '_read', side_effect=read):
            self.assertEqual(qa._verify_context(ctx), self.root)
            file.write_bytes(b'mutated normalized wheel module')
            with self.assertRaisesRegex(qa.QAPending, 'bounded_owned|pin_mismatch'):
                qa._verify_context(ctx)
            file.write_bytes(b'')
            (tools / 'qa/common.mjs').write_bytes(b'changed helper')
            with self.assertRaisesRegex(qa.QAPending, 'helper_changed'):
                qa._verify_context(ctx)

    def test_new_node_helpers_syntax_and_imports_have_no_child_or_file_effects(self):
        node = shutil.which('node')
        if node is None:
            self.skipTest('Node unavailable; no app/PG/browser execution substituted')
        environment = {'PATH': '/usr/bin:/bin', 'TMPDIR': str(TMPROOT), 'LANG': 'C.UTF-8'}
        for item in (HERE / 'qa').iterdir():
            if item.suffix in {'.mjs', '.cjs', '.ts'}:
                # Syntax only: .ts fixture intentionally contains standard JS.
                answer = subprocess.run([node, '--input-type=module' if item.suffix != '.cjs' else '--input-type=commonjs', '--check'], input=item.read_bytes(), capture_output=True, env=environment, cwd=self.root, timeout=10)
                self.assertEqual(answer.returncode, 0, item.name + ': ' + answer.stderr.decode())
        names = [item for item in (HERE / 'qa').iterdir() if item.suffix == '.mjs']
        program = "import cp from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';cp.spawn=()=>{throw Error('unexpected child on import')};syncBuiltinESMExports();" + ''.join('await import(' + json.dumps(item.as_uri()) + ');' for item in names)
        before = {item.name for item in self.root.iterdir()}
        answer = subprocess.run([node, '--input-type=module', '-e', program], capture_output=True, env=environment, cwd=self.root, timeout=10)
        self.assertEqual(answer.returncode, 0, answer.stderr.decode())
        self.assertEqual({item.name for item in self.root.iterdir()}, before)


if __name__ == '__main__':
    unittest.main()
