#!/usr/bin/env python3
"""One fresh, isolated production-baseline run. No automatic job admission."""
import argparse
import datetime
import json
from pathlib import Path
import subprocess
import time
import urllib.request
from production_gate import evaluate

ROOT = Path(__file__).resolve().parents[1]


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--expected-build-id')
    p.add_argument('--job-memory-gib', type=int, default=3, choices=[1, 2, 3])
    p.add_argument('--one-probe', action='store_true', help='Read-only diagnostic; never qualifies admission')
    args = p.parse_args()
    run = ROOT / 'evidence/production-baseline' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S.%fZ')
    run.mkdir(parents=True, mode=0o700)
    probe = (ROOT / 'scripts/production_probe.py').read_text()
    start = time.monotonic()
    previous = None
    samples = []
    while True:
        tick = time.monotonic()
        row = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'elapsed': round(tick - start, 2)}
        try:
            t = time.monotonic()
            with urllib.request.urlopen(urllib.request.Request('https://sancionaintegral.org', headers={'User-Agent': 'PeticaoReadiness/1'}), timeout=10) as response:
                row.update(http=response.status, latency_ms=round((time.monotonic() - t) * 1000, 2))
        except Exception as error:
            row['http_error'] = type(error).__name__
        try:
            result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=5', 'peticao-root', 'python3 -'], input=probe, text=True, capture_output=True, timeout=15, check=True)
            row.update(json.loads(result.stdout))
            if previous and previous.get('boot_id') == row['boot_id']:
                total = row['cpu_total'] - previous.get('cpu_total', row['cpu_total'])
                idle = row['cpu_idle'] - previous.get('cpu_idle', row['cpu_idle'])
                if total > 0 and 0 <= idle <= total:
                    row['cpu_busy_percent'] = round(100 * (1 - idle / total), 2)
        except Exception as error:
            row['node_error'] = type(error).__name__
        samples.append(row)
        previous = row
        with (run / 'samples.jsonl').open('a') as stream:
            stream.write(json.dumps(row) + '\n')
        print(json.dumps({'path': str(run), 'sample': len(samples), 'elapsed': row['elapsed'], 'http': row.get('http'), 'origin_http': row.get('origin_http'), 'build_id': row.get('build_id')}), flush=True)
        if args.one_probe or tick - start >= 1800:
            break
        time.sleep(max(0, min(30 - (time.monotonic() - tick), 1800 - (time.monotonic() - start))))
    result = evaluate(samples, args.expected_build_id, args.job_memory_gib * 2**30)
    result['one_probe_only'] = args.one_probe
    result['automatic_admission_performed'] = False
    (run / 'gate-result.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result), flush=True)


if __name__ == '__main__':
    main()
