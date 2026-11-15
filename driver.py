#!/usr/bin/env python3
"""Fixed isolated real-profile driver TEMPLATE, denied until separately frozen.

No CLI command/env/path is accepted from a job. Root pins this script and a
sealed public policy; the broker separately binds the entire descriptor and
native qualification. Receipt success is never operational readiness.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import stat
import sys
import types

TOOLS = Path('/opt/peticao-dev-profile-tools-v1')
PROGRAM = TOOLS / 'driver.py'
PYTHON = TOOLS / 'python312/bin/python3.12'
POLICY = TOOLS / 'driver-policy.json'
SEALED_POLICY_SHA256 = '0' * 64
POLICY_SHA256 = '0' * 64
KINDS = frozenset({'admin-typecheck-v1', 'admin-build-v1', 'admin-qa-v1'})
LOAD_ORDER = ('artifact_policy', 'resource_plan', 'input_provider', 'process_runner',
              'qa_adapter', 'driver_contract', 'runtime_steps')


def _bootstrap_bytes(path, digest, maximum=4 * 1024**2):
    """Read the first policy verifier without importing project code."""
    if not re.fullmatch('[a-f0-9]{64}', digest) or digest == '0' * 64:
        raise PermissionError('unfrozen_driver_template')
    path = Path(path)
    if not path.is_absolute() or '..' in path.parts:
        raise PermissionError('fixed_public_bootstrap_path_required')
    fd = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        for part in path.parent.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=fd)
            os.close(fd); fd = child
            i = os.fstat(fd)
            if i.st_uid != 0 or i.st_mode & 0o022:
                raise PermissionError('root_controlled_bootstrap_ancestors_required')
        child = os.open(path.name, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK, dir_fd=fd)
    finally:
        os.close(fd)
    try:
        before = os.fstat(child)
        if (not stat.S_ISREG(before.st_mode) or before.st_uid != 0 or before.st_nlink != 1
                or stat.S_IMODE(before.st_mode) not in {0o444, 0o644} or before.st_size > maximum):
            raise PermissionError('bounded_public_bootstrap_required')
        raw = bytearray()
        while block := os.read(child, min(65536, maximum + 1 - len(raw))):
            raw.extend(block)
            if len(raw) > maximum:
                raise PermissionError('bounded_public_bootstrap_required')
        after = os.fstat(child)
        fields = ('st_dev', 'st_ino', 'st_size', 'st_mtime_ns', 'st_ctime_ns', 'st_nlink')
        if (len(raw) != before.st_size or any(getattr(before, k) != getattr(after, k) for k in fields)
                or hashlib.sha256(raw).hexdigest() != digest):
            raise PermissionError('bootstrap_bytes_changed_or_digest_mismatch')
        return bytes(raw)
    finally:
        os.close(child)


def _load(name, raw):
    if name in sys.modules:
        raise PermissionError('project_module_preloaded_before_verification')
    module = types.ModuleType(name)
    module.__file__ = str(TOOLS / (name + '.py'))
    sys.modules[name] = module
    try:
        exec(compile(raw, module.__file__, 'exec'), module.__dict__)
    except BaseException:
        del sys.modules[name]
        raise
    return module


def bootstrap():
    if (Path(__file__).absolute() != PROGRAM or Path(sys.executable) != PYTHON
            or not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode):
        raise PermissionError('fixed_isolated_python_entry_required')
    raw = _bootstrap_bytes(TOOLS / 'sealed_policy.py', SEALED_POLICY_SHA256)
    verifier = _load('sealed_policy', raw)
    policy_raw = verifier.read_verified(str(POLICY), POLICY_SHA256)
    policy = json.loads(policy_raw, object_pairs_hook=_unique_pairs,
                        parse_constant=lambda _: (_ for _ in ()).throw(ValueError('finite_policy_required')))
    verifier.validate_policy(policy, execution=True)
    closure = verifier.verify_closure(policy)
    if closure.get('sealed_policy.py') != raw:
        raise PermissionError('bootstrap_verifier_policy_binding_required')
    modules = {'sealed_policy': verifier}
    for name in LOAD_ORDER:
        modules[name] = _load(name, closure[name + '.py'])
    contract = modules['driver_contract']
    contract.validate_dependencies(policy['dependencies_ref'], execution=True)
    for kind in KINDS:
        if contract.canonical(policy['plans'][kind]) != contract.canonical(contract.plan(kind, policy['dependencies_ref'])):
            raise PermissionError('sealed_plan_does_not_match_fixed_recipe')
    return policy, modules


def _unique_pairs(rows):
    value = {}
    for key, item in rows:
        if key in value:
            raise ValueError('duplicate_policy_key')
        value[key] = item
    return value


def job_root():
    root = Path.cwd()
    if os.geteuid() == 0 or root.parent not in {Path('/var/lib'), Path('/var/lib/private')}:
        raise PermissionError('dynamic_user_state_directory_required')
    if not re.fullmatch('peticao-dev-job-[a-f0-9]{32}-g[1-9][0-9]*', root.name):
        raise PermissionError('fixed_job_state_directory_required')
    info = root.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != os.geteuid() or stat.S_IMODE(info.st_mode) != 0o700:
        raise PermissionError('private_owned_job_directory_required')
    security = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    if int(security['CapEff'].strip(), 16) != 0 or security['NoNewPrivs'].strip() != '1':
        raise PermissionError('no_capabilities_no_new_privileges_required')
    entries = {p.name for p in root.iterdir()}
    if entries - {'tmp'}:
        raise PermissionError('fresh_job_no_replay_required')
    if 'tmp' in entries:
        tmp = root / 'tmp'; i = tmp.lstat()
        if not stat.S_ISDIR(i.st_mode) or i.st_uid != os.geteuid() or stat.S_IMODE(i.st_mode) != 0o700 or any(tmp.iterdir()):
            raise PermissionError('fresh_private_initial_tmp_required')
    return root


class Context:
    def __init__(self, root, kind, policy, contract):
        self.root, self.kind, self.policy = Path(root), kind, policy
        self.tools, self.node, self.python = TOOLS, TOOLS / 'node20', PYTHON
        self.chromium = TOOLS / 'chromium/chrome-linux64/chrome'
        self.site, self.compiled = self.root / 'source/site', self.root / 'compiled'
        self.dependencies = policy['dependencies_ref']
        self.plan = policy['plans'][kind]
        self.resources = self.plan['resources']
        self.qa_inventory = policy['qa_inventory']
        self.qa_closure_sha256 = contract.digest(self.qa_inventory)
        self.input_verification = None

    def verify_inputs(self, provider, contract):
        """Hash/preflight both archives before mutable job initialization."""
        source = contract.SOURCE
        deps = self.dependencies['normalized_archive']
        for row, kind in ((source, 'source'), (deps, 'deps')):
            with provider.verified_input(row['path'], row['sha256'], row['bytes']) as stream:
                provider.archive_manifest(stream, kind)
        self.input_verification = {'files': 2, 'bytes': source['bytes'] + deps['bytes']}

    def initialize(self):
        fd = os.open(self.root / 'driver-intent.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, 'wb') as f:
            f.write(b'{"version":1,"no_replay":true}\n'); f.flush(); os.fsync(f.fileno())
        for name in ('t', 'e', 'c', 'g', 'r', 'outbox'):
            (self.root / name).mkdir(mode=0o700)

    def env_for(self, cwd, phase):
        cwd = Path(cwd)
        if not cwd.is_absolute():
            cwd = self.root / cwd
        cwd.relative_to(self.root)
        rel = lambda name: os.path.relpath(self.root / name, cwd)
        build = phase != 'qa'
        return {'PATH': str(TOOLS) + ':/usr/bin:/bin', 'LANG': 'C.UTF-8', 'TZ': 'UTC',
                'HOME': rel('e'), 'TMPDIR': rel('t'), 'TMP': rel('t'), 'TEMP': rel('t'),
                'XDG_CACHE_HOME': rel('c'), 'XDG_CONFIG_HOME': rel('g'), 'XDG_RUNTIME_DIR': rel('r'),
                'NEXT_TELEMETRY_DISABLED': '1', 'NEXT_BUILD_CPUS': '2', 'PYTHONDONTWRITEBYTECODE': '1',
                'NODE_ENV': 'production' if build else 'test', 'MAIL_PROVIDER': 'dev', 'MAIL_PROVIDERS': 'dev',
                'WHATSAPP_ENABLED': '0', 'CRON_SECRET': '', 'SECRETS_DIR': rel('e'),
                'CREDENTIALS_DIRECTORY': rel('e'), 'PETICAO_CONFIG_DIR': rel('e'), 'GEO_DIR': rel('e'),
                'MAIL_OUTBOX_DIR': rel('outbox'), 'HASH_PEPPER': 'PROFILE-FIXTURE-ONLY-NOT-PRODUCTION-v1',
                'ADMIN_PASSWORD': 'ProfileFixtureOnly-v1', 'CPF_CACHE_ENCRYPTION_KEY': 'c' * 64,
                'DATABASE_URL': 'postgres://build:build@127.0.0.1:1/build' if build else 'postgres://peticao:peticao@127.0.0.1:28451/peticao',
                'NODE_OPTIONS': ('--import=' + str(TOOLS / 'qa/build-guard.mjs') if build else '--require=' + str(TOOLS / 'qa/network-guard.cjs')) + ' --max-old-space-size=' + str(self.resources['node_heap_mib'])}


def phase(name, success=True):
    return {'name': name, 'exit_code': 0 if success else 1, 'signal': None, 'duration_ms': 0,
            'expected_checks': 0, 'observed_checks': 0, 'success': success}


def _cancel(signum, frame):
    # A second stop is not suppressed. The root runtime still owns cgroup stop.
    signal.signal(signum, signal.SIG_DFL)
    raise RuntimeError('driver_stop_requested')


def execute(ctx, modules, supervisor):
    """One attempt; fixed recipe, stop on first failure, preserve private state."""
    if ctx.input_verification is None:
        raise PermissionError('verified_input_archives_before_execution_required')
    a, c, steps = modules['artifact_policy'], modules['driver_contract'], modules['runtime_steps']
    phases, qa_result, failed = [phase('verify-inputs')], None, None
    current = 'prepare-offline-assets'
    def append(row, name):
        if type(row) is not dict or row.get('name') != name:
            raise ValueError('fixed_phase_order_required')
        a.validate_json('phase-results.json', {'version': 1, 'profile': ctx.kind, 'phases': [row]})
        phases.append(row)
        if row['success'] is not True:
            raise RuntimeError('profile_phase_failed')
    try:
        for current, function in [('prepare-offline-assets', steps.prepare), ('typecheck', steps.typecheck)]:
            append(function(ctx, supervisor), current)
        if ctx.kind != 'admin-typecheck-v1':
            for current, function in [('build', steps.build), ('export-runtime', steps.export_runtime)]:
                append(function(ctx, supervisor), current)
        if ctx.kind == 'admin-qa-v1':
            current = 'qa100'; qa_result = modules['qa_adapter'].run_qa(ctx, supervisor)
            if len(qa_result['phases']) != 1:
                raise ValueError('one_owned_qa100_phase_required')
            append(qa_result['phases'][0], current)
            if qa_result['summary']['passed'] is not True or qa_result['network']['unexpected_attempts'] != 0:
                raise RuntimeError('qa_summary_or_network_failed')
    except Exception:
        failed = current
        if phases[-1]['name'] != current:
            phases.append(phase(current, False))
        else:
            phases[-1]['success'] = False
    finally:
        drain = supervisor.drain(stop=True)
        safe_drain = drain['all_exited'] is True and drain['remaining_owned_processes'] == 0
        phases.append(phase('drain', safe_drain))
        if not safe_drain and failed is None:
            failed = 'drain'
    status = 'passed' if failed is None else 'failed'
    result = {'version': 1, 'profile': ctx.kind, 'plan_sha256': c.digest(ctx.plan),
              'source_sha256': c.SOURCE['sha256'], 'dependencies_sha256': c.digest(ctx.dependencies),
              'artifact_policy_sha256': a.digest_policy(), 'status': status, 'exit_code': 0 if failed is None else 1,
              'phase_count': len(phases), 'failed_phase': failed}
    records = {'profile-result.json': result, 'phase-results.json': {'version': 1, 'profile': ctx.kind, 'phases': phases},
               'process-drain-proof.json': drain}
    inventory = ctx.policy['toolchain_inventory']['files']
    records['integrity-proof.json'] = {'version': 1, 'source_sha256': c.SOURCE['sha256'],
        'dependencies_sha256': c.digest(ctx.dependencies), 'toolchain_sha256': c.digest(ctx.policy['toolchain_inventory']),
        'verified_files': len(inventory) + ctx.input_verification['files'],
        'verified_bytes': sum(row['bytes'] for row in inventory.values()) + ctx.input_verification['bytes'],
        'archive_only_provenance': False}
    if qa_result is not None:
        records['sanitized-qa-summary.json'] = qa_result['summary']
        records['network-denial-summary.json'] = qa_result['network']
    for name, value in records.items():
        a.validate_json(name, value)
        a.write_artifact(ctx.root / 'artifacts', name, (c.canonical(value) + '\n').encode())
    # Construct receipts, rather than exporting arbitrary raw child log content.
    log = ''.join(row['name'] + ': ' + ('passed' if row['success'] else 'failed') + '\n' for row in phases).encode()
    a.write_artifact(ctx.root / 'artifacts', 'sanitized-build.log', a.sanitize_log(log))
    a.inspect_artifacts(ctx.root / 'artifacts')
    # WorkerRPC reads this bounded private report OUTSIDE the artifact tree.
    # The root worker remains responsible for binding observed unit exit code.
    raw = (c.canonical({'protocol': 1, 'profile': ctx.kind, 'exit_code': result['exit_code']}) + '\n').encode()
    fd = os.open(ctx.root / 'result.json', os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as f:
        f.write(raw); f.flush(); os.fsync(f.fileno())
    fd = os.open(ctx.root, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try: os.fsync(fd)
    finally: os.close(fd)
    return result


def main():
    if len(sys.argv) != 2 or sys.argv[1] not in KINDS:
        raise PermissionError('one_fixed_real_profile_argument_required')
    os.umask(0o077)
    policy, modules = bootstrap()
    ctx = Context(job_root(), sys.argv[1], policy, modules['driver_contract'])
    # IPC is measured before any workload, not repaired by adding a bind mount.
    if ctx.kind == 'admin-qa-v1':
        modules['qa_adapter'].measure_ipc(ctx.root)
    ctx.verify_inputs(modules['input_provider'], modules['driver_contract'])
    ctx.initialize()
    modules['artifact_policy'].prepare_artifacts(ctx.root / 'artifacts')
    allowed = {v['path']: v['sha256'] for v in ctx.dependencies['toolchain'].values()}
    supervisor = modules['process_runner'].Supervisor(ctx.root, allowed)
    previous = {sig: signal.getsignal(sig) for sig in (signal.SIGTERM, signal.SIGINT)}
    try:
        for sig in previous:
            signal.signal(sig, _cancel)
        result = execute(ctx, modules, supervisor)
    finally:
        for sig, handler in previous.items():
            signal.signal(sig, handler)
        supervisor.close()
    return result['exit_code']


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # No raw paths, values, credentials, exception messages or log content.
        print(json.dumps({'ok': False, 'error_type': type(error).__name__}))
        raise SystemExit(1)
