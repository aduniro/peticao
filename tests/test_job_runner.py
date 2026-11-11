import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SPEC = importlib.util.spec_from_file_location('job_runner', Path(__file__).resolve().parents[1] / 'runner/job_runner.py')
runner = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(runner)


class FakeGate:
    def __init__(self, lose_start=False, lose_finish=False, allowed=True):
        self.calls, self.finish = [], None
        self.lose_start, self.lose_finish, self.allowed = lose_start, lose_finish, allowed

    def request(self, endpoint, body):
        self.calls.append(endpoint)
        if endpoint == 'start':
            if self.lose_start:
                raise OSError('lost_response_after_claim')
            return {'execution_authorized': self.allowed}
        if endpoint == 'finish':
            self.finish = body
            if self.lose_finish:
                raise OSError('lost_response_after_finish')
            return {'finished': True}
        return {'started': True, 'finished': self.finish is not None,
                'execution_authorized': False,
                'result': {'exit_code': self.finish['exit_code'], 'technical_result': self.finish['technical_result'],
                           'artifacts': []} if self.finish else None}


class RunnerTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.identity = {'id': 'a' * 32, 'pod_name': 'fixture', 'pod_uid': 'fixture-uid'}
        self.plan = {'argv': ['/usr/bin/python3', '-c', 'print("synthetic")'],
                     'timeout_seconds': 3, 'source_commit': 'f' * 40, 'manifest_sha256': 'b' * 64}
        self.executions = 0

    def tearDown(self):
        self.tmp.cleanup()

    def executor(self, plan, run, output):
        self.executions += 1
        return 0

    def test_unknown_or_denied_start_never_executes_even_if_receipt_says_started(self):
        for gate in [FakeGate(lose_start=True), FakeGate(allowed=False)]:
            result = runner.run_once('unit', self.identity, self.plan, gate, self.root, self.executor)
            self.assertEqual(result, 78)
            self.assertEqual(self.executions, 0)
            self.assertEqual(gate.calls.count('start'), 1)
            self.assertFalse((self.root / 'execution.started').exists())

    def test_lost_finish_response_queries_same_receipt_without_execution_retry(self):
        gate = FakeGate(lose_finish=True)
        result = runner.run_once('unit', self.identity, self.plan, gate, self.root, self.executor)
        self.assertEqual(result, 0)
        self.assertEqual(self.executions, 1)
        self.assertEqual(gate.calls, ['start', 'finish', 'receipt'])

    def test_child_environment_never_inherits_capability_or_real_config(self):
        with patch.dict(os.environ, {'PETICAO_CLAIM_TOKEN': 'test-only-capability', 'SMTP_PASSWORD': 'test-only-password'}):
            env = runner.child_environment(self.root)
        self.assertNotIn('PETICAO_CLAIM_TOKEN', env)
        self.assertNotIn('SMTP_PASSWORD', env)
        self.assertEqual(env['MAIL_PROVIDER'], 'dev')
        self.assertEqual(env['WHATSAPP_ENABLED'], '0')

    def test_descendant_is_stopped_even_when_parent_exits_successfully(self):
        script = 'import subprocess,sys; p=subprocess.Popen([sys.executable,"-c","import time; time.sleep(30)"]); print(p.pid,flush=True)'
        plan = {**self.plan, 'argv': ['/usr/bin/python3', '-c', script]}
        log = self.root / 'runner.log'
        self.assertEqual(runner.execute(plan, self.root, log), 0)
        pid = int(log.read_text().strip())
        status = Path('/proc') / str(pid) / 'stat'
        if status.exists():
            self.assertEqual(status.read_text().rpartition(') ')[2].split()[0], 'Z')

    def test_artifact_links_are_rejected(self):
        artifacts = self.root / 'artifacts'
        artifacts.mkdir()
        (artifacts / 'report.txt').symlink_to('/etc/passwd')
        with self.assertRaises(ValueError): runner.artifact_payload(artifacts)
