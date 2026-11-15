"""Pure fictitious receipts only; no host, native bus or subprocess access."""
from copy import deepcopy
import unittest

import resource_plan as resources


def snapshot():
    metrics = {"avg10": 0.0, "avg60": 0.0, "avg300": 0.0, "total": 123.0}
    return {
        "version": 1, "observed_unix": 1000.0, "affinity_cpus": 16,
        "memory_bytes": {"MemTotal": 32083320832, "MemAvailable": 31107411968,
                         "SwapTotal": 0, "SwapFree": 0},
        "pressure": {key: {"some": deepcopy(metrics), "full": deepcopy(metrics)}
                     for key in ("cpu", "memory", "io")},
    }


class ResourcePlanTests(unittest.TestCase):
    def test_fixed_recipes(self):
        for name, cpu, memory, heap in (("balanced-v1", 4, 8, 3072),
                                        ("heavy-candidate-v1", 14, 20, 6144)):
            with self.subTest(name=name):
                value = resources.plan(name)
                self.assertEqual((value["cpu"], value["memory_bytes"], value["node_heap_mib"]),
                                 (cpu, memory * 1024**3, heap))
                self.assertEqual(resources.validate(value), value)
                self.assertFalse(value["measured_minimum"])
                self.assertFalse(value["disk_budget_is_hard_quota"])

    def test_copy_isolation(self):
        value = resources.plan("balanced-v1")
        validated = resources.validate(value)
        value["admission"]["control_cpu_target"] = 0
        validated["cpu"] = 99
        self.assertEqual(resources.plan("balanced-v1")["admission"]["control_cpu_target"], 2)
        self.assertEqual(resources.plan("balanced-v1")["cpu"], 4)

    def test_no_free_names(self):
        for name in (True, 1, None, [], "heavy-v1", "balanced-v1 "):
            with self.subTest(name=name), self.assertRaises(ValueError):
                resources.plan(name)

    def test_exact_values_and_types_recursively(self):
        original = resources.plan("balanced-v1")
        for key, item in original.items():
            if type(item) is dict:
                for nested in item:
                    value = deepcopy(original)
                    value[key][nested] = 0 if type(item[nested]) is bool else False
                    with self.subTest(key=(key, nested)), self.assertRaises(ValueError):
                        resources.validate(value)
            else:
                value = deepcopy(original)
                value[key] = 0 if type(item) is bool else float(item)
                with self.subTest(key=key), self.assertRaises(ValueError):
                    resources.validate(value)

    def test_no_extensions_or_mixed_recipe(self):
        for value in (None, [], {**resources.plan("balanced-v1"), "DiskMax": "30G"},
                      {**resources.plan("balanced-v1"), "cpu": 14},
                      {**resources.plan("heavy-candidate-v1"), "memory_bytes": 24 * 1024**3}):
            with self.subTest(value=value), self.assertRaises(ValueError):
                resources.validate(value)

    def test_exact_systemd_properties(self):
        self.assertEqual(resources.systemd_properties(resources.plan("heavy-candidate-v1")), {
            "CPUQuota": "1400%", "MemoryMax": "21474836480", "MemorySwapMax": "0",
            "TasksMax": "512", "RuntimeMaxSec": "2700", "TimeoutStopSec": "30"})

    def test_mapper_cannot_accept_arbitrary_properties(self):
        value = resources.plan("balanced-v1")
        value["ExecStart"] = "/bin/false"
        with self.assertRaises(ValueError):
            resources.systemd_properties(value)

    def test_both_fit_fictitious_measured_capacity(self):
        for name in ("balanced-v1", "heavy-candidate-v1"):
            self.assertEqual(resources.assess_admission(resources.plan(name), snapshot(), 1010),
                             {"pass": True, "fail_reasons": []})

    def test_exact_capacity_and_age_boundaries(self):
        value = snapshot()
        value["affinity_cpus"] = 6
        value["memory_bytes"] = {"MemTotal": 16 * 1024**3, "MemAvailable": 16 * 1024**3}
        self.assertTrue(resources.assess_admission(resources.plan("balanced-v1"), value, 1030)["pass"])
        value["memory_bytes"]["MemAvailable"] -= 1
        self.assertIn("insufficient_memory_available", resources.assess_admission(
            resources.plan("balanced-v1"), value, 1030)["fail_reasons"])

    def test_job_and_reserve_both_count(self):
        value = snapshot()
        value["affinity_cpus"] = 14
        value["memory_bytes"] = {"MemTotal": 27 * 1024**3, "MemAvailable": 26 * 1024**3}
        result = resources.assess_admission(resources.plan("heavy-candidate-v1"), value, 1000)
        self.assertFalse(result["pass"])
        self.assertEqual(result["fail_reasons"], ["insufficient_cpu_capacity",
                         "insufficient_memory_capacity", "insufficient_memory_available"])

    def test_stale_and_future(self):
        for now, reason in ((1030.001, "snapshot_stale"), (999, "snapshot_from_future")):
            self.assertIn(reason, resources.assess_admission(resources.plan("balanced-v1"),
                                                           snapshot(), now)["fail_reasons"])

    def test_each_pressure_average_denies_but_totals_do_not(self):
        for resource in ("cpu", "memory", "io"):
            for scope in ("some", "full"):
                for average in ("avg10", "avg60", "avg300"):
                    value = snapshot()
                    value["pressure"][resource][scope][average] = 0.001
                    self.assertIn("pressure_busy_" + resource, resources.assess_admission(
                        resources.plan("balanced-v1"), value, 1000)["fail_reasons"])

    def test_unknown_partial_or_malformed_snapshot_denied(self):
        invalid = [None, {}, [], {**snapshot(), "affinity_cpus": True},
                   {**snapshot(), "version": True}, {**snapshot(), "observed_unix": float("nan")},
                   {**snapshot(), "observed_unix": 10**1000}]
        for path, replacement in ((["memory_bytes", "MemAvailable"], True),
                                  (["memory_bytes", "MemTotal"], -1),
                                  (["memory_bytes", "SwapFree"], 1),
                                  (["pressure", "io", "full", "avg10"], float("inf")),
                                  (["pressure", "cpu", "some", "avg60"], True),
                                  (["pressure", "memory", "full", "avg300"], 101)):
            value = snapshot()
            target = value
            for key in path[:-1]:
                target = target[key]
            target[path[-1]] = replacement
            invalid.append(value)
        partial = snapshot()
        del partial["pressure"]["io"]["full"]
        invalid.append(partial)
        for value in invalid:
            with self.subTest(value=value):
                self.assertEqual(resources.assess_admission(resources.plan("balanced-v1"), value, 1000),
                                 {"pass": False, "fail_reasons": ["invalid_snapshot"]})

    def test_invalid_clock_denied(self):
        for now in (True, None, "1000", float("nan"), float("inf"), -1, 10**1000):
            self.assertIn("invalid_now", resources.assess_admission(resources.plan("balanced-v1"),
                                                                   snapshot(), now)["fail_reasons"])

    def test_admission_never_repairs_invalid_recipe(self):
        value = resources.plan("balanced-v1")
        value["admission"]["requires_fresh_host_pressure_and_capacity"] = False
        with self.assertRaises(ValueError):
            resources.assess_admission(value, snapshot(), 1000)

    def test_extra_receipt_metadata_not_authoritative(self):
        value = snapshot()
        value.update({"qualified": True, "candidate": {"eligible_capacity_candidate": True}})
        value["affinity_cpus"] = 1
        self.assertFalse(resources.assess_admission(resources.plan("balanced-v1"), value, 1000)["pass"])

    def test_inputs_not_mutated(self):
        value = resources.plan("balanced-v1")
        measured = snapshot()
        original = deepcopy((value, measured))
        resources.systemd_properties(value)
        resources.assess_admission(value, measured, 1000)
        self.assertEqual((value, measured), original)

    def test_source_flags(self):
        self.assertTrue(resources.SOURCE_ONLY)
        for flag in (resources.QUALIFIED, resources.OPERATIONAL_READY,
                     resources.DISPATCH_ENABLED, resources.INSTALLS_OR_RUNS_HOST):
            self.assertIs(flag, False)


if __name__ == "__main__":
    unittest.main()
