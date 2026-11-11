#!/usr/bin/python3
"""Fixed-image runner: one start request, no execution after an uncertain response."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import signal
import ssl
import stat
import subprocess
import time
import urllib.error
import urllib.request

PROFILES = {'typecheck', 'unit', 'postgres17', 'build', 'browser', 'pdf-png'}
IMAGE_ROOT = Path('/opt/peticao-runner')
MAX_LOG = 10 * 1024 * 1024
MAX_ARTIFACTS = 32 * 1024 * 1024


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *_):
        raise ValueError('gateway_redirect_forbidden')


class Gateway:
    def __init__(self, token, ca_file, url='https://100.80.18.81:9444'):
        self.token, self.url = token, url
        context = ssl.create_default_context(cafile=str(ca_file))
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect(),
                                                  urllib.request.HTTPSHandler(context=context))

    def request(self, endpoint, body):
        request = urllib.request.Request(self.url + '/v1/' + endpoint, data=json.dumps(body).encode(),
                                         headers={'Content-Type': 'application/json',
                                                  'Authorization': 'Bearer ' + self.token})
        # No retries. The caller can query the same identifier after uncertainty.
        try:
            with self.opener.open(request, timeout=15) as response:
                if response.status != 200:
                    raise RuntimeError('gateway_response_denied')
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code == 409 and endpoint == 'start':
                return {'execution_authorized': False}
            raise RuntimeError('gateway_response_denied') from None


def readonly_image_file(path, limit=128 * 1024):
    info = path.lstat()
    if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o022 or info.st_size > limit:
        raise PermissionError('root_owned_immutable_image_file_required')
    return path.read_bytes()


def load_profile(name):
    if name not in PROFILES:
        raise ValueError('unknown_fixed_profile')
    manifest = json.loads(readonly_image_file(IMAGE_ROOT / 'runner-manifest.json'))
    if not re.fullmatch('[a-f0-9]{40}', str(manifest.get('source_commit'))) or not re.fullmatch('[a-f0-9]{64}', str(manifest.get('source_manifest_sha256'))):
        raise ValueError('immutable_source_identity_required')
    if manifest['source_commit'] != os.environ.get('PETICAO_SOURCE_COMMIT') or manifest['source_manifest_sha256'] != os.environ.get('PETICAO_SOURCE_MANIFEST_SHA256'):
        raise PermissionError('approved_pod_source_identity_mismatch')
    profile = manifest['profiles'].get(name)
    executable = IMAGE_ROOT / 'profiles' / (name + '.py')
    if not profile or hashlib.sha256(readonly_image_file(executable)).hexdigest() != profile['sha256']:
        raise ValueError('reviewed_profile_executable_required')
    timeout = profile.get('timeout_seconds')
    if type(timeout) is not int or not 30 <= timeout <= 3540:
        raise ValueError('bounded_profile_timeout_required')
    return {'argv': ['/usr/bin/python3', '-I', str(executable)], 'timeout_seconds': timeout,
            'source_commit': manifest['source_commit'],
            'manifest_sha256': hashlib.sha256(readonly_image_file(IMAGE_ROOT / 'runner-manifest.json')).hexdigest()}


def child_environment(run):
    empty = run / 'empty'
    temp = run / 'tmp'
    for directory in (empty, temp):
        directory.mkdir(mode=0o700)
    # Never pass the capability, host environment or inherited real delivery config to tests.
    env = {'PATH': '/usr/local/bin:/usr/bin:/bin', 'HOME': str(empty), 'LANG': 'C.UTF-8', 'TZ': 'UTC',
           'NODE_ENV': 'production', 'APP_URL': 'https://sancionaintegral.org',
           'DATABASE_URL': 'postgres://build_only:build_only@127.0.0.1:1/build_only',
           'HASH_PEPPER': 'BUILD_ONLY_PEPPER_NOT_PRODUCTION_0123456789',
           'ADMIN_PASSWORD': 'BuildOnly-NotAProductionPassword',
           'ADMIN_PASSWORD_FILE': str(empty / 'admin-password-never-present.hash'),
           'MAIL_PROVIDER': 'dev', 'MAIL_PROVIDERS': 'dev', 'MAIL_PROVIDERS_MARKETING': '',
           'MAIL_FROM': 'Build only <noreply@build.invalid>', 'CONTACT_TO': 'noreply@build.invalid',
           'CONTACT_BCC': '', 'RECIPIENTS': '', 'APPROVER_EMAIL': '', 'CRON_SECRET': '',
           'WHATSAPP_ENABLED': '0', 'SIGNER': 'none', 'NEXT_TELEMETRY_DISABLED': '1', 'CI': '1',
           'TMPDIR': str(temp), 'PRODUCTION_PROFILE_ROOT': '/work', 'PRODUCTION_PROFILE_RUN': str(run)}
    for key in ('SECRETS_DIR', 'PETICAO_CONFIG_DIR', 'CREDENTIALS_DIRECTORY', 'GEO_DIR'):
        env[key] = str(empty)
    return env


def execute(plan, run, output):
    env = child_environment(run)
    process = None
    canceled = False

    def stop(*_):
        nonlocal canceled
        canceled = True
        if process is not None and process.poll() is None:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass

    prior = signal.signal(signal.SIGTERM, stop)
    started = time.monotonic()
    try:
        with output.open('xb') as log:
            process = subprocess.Popen(plan['argv'], cwd=run, env=env, stdin=subprocess.DEVNULL,
                                       stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            while process.poll() is None:
                over_time = time.monotonic() - started >= plan['timeout_seconds']
                over_log = output.stat().st_size > MAX_LOG
                if canceled or over_time or over_log:
                    try:
                        os.killpg(process.pid, signal.SIGTERM)
                    except ProcessLookupError:
                        pass
                    try:
                        process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=5)
                    return 130 if canceled else 124 if over_time else 125
                time.sleep(.1)
            return process.returncode if process.returncode >= 0 else 128 - process.returncode
    finally:
        signal.signal(signal.SIGTERM, prior)
        if process is not None:
            # A successful parent can leave workers/PG descendants behind.
            # They belong to this job's process group and must stop before finish.
            try:
                os.killpg(process.pid, signal.SIGTERM)
                deadline = time.monotonic() + 2
                while time.monotonic() < deadline:
                    try:
                        os.killpg(process.pid, 0)
                    except ProcessLookupError:
                        break
                    time.sleep(.05)
                else:
                    os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            if process.poll() is None:
                process.wait(timeout=5)


def artifact_payload(directory):
    payload, total = [], 0
    for path in sorted(directory.rglob('*')):
        if path.is_symlink():
            raise ValueError('artifact_link_forbidden')
        if path.is_dir():
            continue
        info = path.stat()
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 16 * 1024 * 1024:
            raise ValueError('bounded_regular_artifact_required')
        if path.suffix.lower() not in {'.json', '.png', '.pdf', '.txt', '.log', '.xml'}:
            raise ValueError('technical_artifact_extension_required')
        total += info.st_size
        if total > MAX_ARTIFACTS or len(payload) >= 64:
            raise ValueError('artifact_budget_exceeded')
        data = path.read_bytes()
        payload.append({'path': 'artifacts/' + path.relative_to(directory).as_posix(),
                        'sha256': hashlib.sha256(data).hexdigest(), 'base64': base64.b64encode(data).decode()})
    return payload


def run_once(name, identity, plan, gateway, work=Path('/work'), executor=execute):
    try:
        response = gateway.request('start', identity)
    except Exception:
        # Even a receipt saying "started" is not permission to repeat commands.
        try:
            gateway.request('receipt', identity)
        except Exception:
            pass
        return 78
    if response.get('execution_authorized') is not True:
        return 78
    marker = work / 'execution.started'
    fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    run = work / 'runs' / identity['id']
    run.mkdir(parents=True, mode=0o700)
    artifacts = work / 'artifacts'
    artifacts.mkdir(mode=0o700)
    start = time.monotonic()
    code = executor(plan, run, artifacts / 'runner.log')
    technical = {'profile': name, 'elapsed_seconds': round(time.monotonic() - start, 3),
                 'source_commit': plan['source_commit'], 'runner_manifest_sha256': plan['manifest_sha256']}
    files = artifact_payload(artifacts)
    body = {**identity, 'exit_code': code, 'technical_result': technical, 'artifacts': files}
    try:
        gateway.request('finish', body)
    except Exception:
        try:
            observed = gateway.request('receipt', identity)
            result = observed.get('result') or {}
            expected = [{'path': item['path'], 'sha256': item['sha256'],
                         'bytes': len(base64.b64decode(item['base64']))} for item in files]
            if not observed.get('finished') or result.get('exit_code') != code or result.get('technical_result') != technical or result.get('artifacts') != expected:
                return 79
        except Exception:
            return 79
    return code


def main():
    import sys
    os.umask(0o077)
    if len(sys.argv) != 2 or os.getuid() != 10001 or not os.statvfs('/').f_flag & os.ST_RDONLY:
        raise PermissionError('restricted_readonly_job_container_required')
    status = dict(line.split(':', 1) for line in Path('/proc/self/status').read_text().splitlines() if ':' in line)
    if int(status['CapEff'].strip(), 16) or status.get('NoNewPrivs', '').strip() != '1':
        raise PermissionError('no_capabilities_and_no_new_privileges_required')
    identity = {'id': os.environ['PETICAO_JOB_ID'], 'pod_name': os.environ['POD_NAME'], 'pod_uid': os.environ['POD_UID']}
    token = os.environ['PETICAO_CLAIM_TOKEN']
    if not re.fullmatch('[a-f0-9]{32}', identity['id']) or not re.fullmatch('[a-f0-9]{64}', token):
        raise ValueError('job_identity_required')
    plan = load_profile(sys.argv[1])
    return run_once(sys.argv[1], identity, plan, Gateway(token, IMAGE_ROOT / 'claims-ca.crt'))


if __name__ == '__main__':
    raise SystemExit(main())
