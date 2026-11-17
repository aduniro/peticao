import copy
import importlib.util
import pathlib
import unittest

SPEC = importlib.util.spec_from_file_location('gate', pathlib.Path(__file__).resolve().parents[1] / 'scripts/production_gate.py')
gate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(gate)


class GateTests(unittest.TestCase):
    def setUp(self):
        self.samples = [{'elapsed': i * 30, 'http': 200, 'origin_http': 200,
                         'build_id': 'reviewed-build', 'main_pid': 123, 'boot_id': 'boot-a',
                         'cpu_busy_percent': 20, 'mem_available': 6 * 2**30,
                         'latency_ms': 180} for i in range(61)]

    def check(self, samples=None, build='reviewed-build'):
        return gate.evaluate(samples if samples is not None else self.samples, build, 3 * 2**30)

    def test_complete_stable_window_admits_and_sets_pressure_threshold(self):
        result = self.check()
        self.assertTrue(result['eligible'])
        self.assertEqual(result['cancel_threshold_p95_ms'], 280)

    def test_deploy_restart_reboot_failures_and_missing_pressure_data_close_gate(self):
        for change in [{'build_id': 'new-build'}, {'main_pid': 124}, {'boot_id': 'boot-b'},
                       {'http': 502}, {'origin_http': 500}, {'cpu_busy_percent': 60},
                       {'cpu_busy_percent': None}, {'mem_available': 4 * 2**30}]:
            samples = copy.deepcopy(self.samples)
            samples[-1].update(change)
            self.assertFalse(self.check(samples)['eligible'], change)

    def test_old_http_only_baseline_and_unverified_release_cannot_admit(self):
        self.assertFalse(self.check(build=None)['eligible'])
        self.assertFalse(self.check(self.samples[:30])['eligible'])
        samples = [{k: v for k, v in row.items() if k not in ('build_id', 'origin_http', 'cpu_busy_percent')} for row in self.samples]
        self.assertFalse(self.check(samples)['eligible'])

    def test_sample_gaps_fail_even_with_adequate_total_duration(self):
        samples = self.samples[:30] + self.samples[31:]
        self.assertFalse(self.check(samples)['eligible'])
