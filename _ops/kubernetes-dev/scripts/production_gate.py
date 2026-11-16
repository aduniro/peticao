#!/usr/bin/env python3
"""Fail-closed admission evaluation; observation is not a production deploy receipt."""
import math


def evaluate(samples, expected_build, job_memory_bytes, required_seconds=1800):
    reasons = []
    if not samples:
        return {'eligible': False, 'reasons': ['no_samples']}
    if not expected_build:
        reasons.append('verified_post_deploy_build_required')
    if samples[-1]['elapsed'] - samples[0]['elapsed'] < required_seconds:
        reasons.append('baseline_duration_incomplete')
    if len(samples) < 60:
        reasons.append('baseline_sample_count_incomplete')
    if any(b['elapsed'] - a['elapsed'] > 45 for a, b in zip(samples, samples[1:])):
        reasons.append('baseline_observation_gap')
    if any(s.get('http') != 200 or s.get('origin_http') != 200 for s in samples):
        reasons.append('production_http_failure_or_missing')
    builds = {s.get('build_id') for s in samples}
    pids = {s.get('main_pid') for s in samples}
    boots = {s.get('boot_id') for s in samples}
    if builds != {expected_build} or None in builds:
        reasons.append('production_build_changed_or_unknown')
    if len(pids) != 1 or None in pids or 0 in pids:
        reasons.append('production_pid_changed_or_unknown')
    if len(boots) != 1 or None in boots:
        reasons.append('node_reboot_or_unknown')
    recent = [s for s in samples if s['elapsed'] >= samples[-1]['elapsed'] - 300]
    if len(recent) < 10 or recent[-1]['elapsed'] - recent[0]['elapsed'] < 270:
        reasons.append('five_minute_stability_window_missing')
    if any(not isinstance(s.get('cpu_busy_percent'), (int, float)) or
           not math.isfinite(s['cpu_busy_percent']) or not 0 <= s['cpu_busy_percent'] < 60 for s in recent):
        reasons.append('cpu_pressure_or_unknown')
    if any(not isinstance(s.get('mem_available'), int) or
           s['mem_available'] < job_memory_bytes + 2 * 2**30 for s in recent):
        reasons.append('memory_headroom_insufficient_or_unknown')
    latency = sorted(s['latency_ms'] for s in samples if isinstance(s.get('latency_ms'), (int, float)))
    p95 = latency[max(0, math.ceil(len(latency) * .95) - 1)] if latency else None
    if len(latency) != len(samples) or p95 is None:
        reasons.append('latency_baseline_missing')
    return {'eligible': not reasons, 'reasons': reasons, 'p95_ms': p95,
            'cancel_threshold_p95_ms': max(p95 * 1.25, p95 + 100) if p95 is not None else None,
            'sample_count': len(samples), 'expected_build': expected_build}
