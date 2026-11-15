"""Offline operator-only producer of pinned qualification candidates.

Not a worker/helper/RPC entry. No install, host mutation, child execution or
readiness flag. An enabled, fully pinned policy/release and exact reviewed
template SHA are required; outputs are exclusive and must get a new manifest.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import stat

import driver_contract as contract
import sealed_policy


def render(template, policy, verifier_sha256):
    if type(template) is not bytes or len(template) > 1048576:
        raise ValueError('bounded_reviewed_template_required')
    contract.hex_value(verifier_sha256)
    sealed_policy.validate_policy(policy, execution=True)
    contract.validate_dependencies(policy['dependencies_ref'], execution=True)
    for kind in contract.KINDS:
        if contract.canonical(policy['plans'][kind]) != contract.canonical(contract.plan(kind, policy['dependencies_ref'])):
            raise ValueError('fixed_recipe_plan_required')
    if policy['helpers']['sealed_policy.py']['sha256'] != verifier_sha256:
        raise ValueError('verifier_policy_binding_required')
    policy_bytes = (contract.canonical(policy) + '\n').encode()
    policy_sha = hashlib.sha256(policy_bytes).hexdigest()
    for symbol, value in [('SEALED_POLICY_SHA256', verifier_sha256), ('POLICY_SHA256', policy_sha)]:
        placeholder = (symbol + " = '0' * 64").encode()
        if template.count(placeholder) != 1:
            raise ValueError('exact_unfrozen_template_marker_required')
        template = template.replace(placeholder, (symbol + ' = ' + repr(value)).encode())
    program_sha = hashlib.sha256(template).hexdigest()
    candidates = {kind: contract.catalog_candidate(kind, program_sha, policy['dependencies_ref']) for kind in sorted(contract.KINDS)}
    return {'driver.py': template, 'driver-policy.json': policy_bytes,
            'catalog.candidates.json': (contract.canonical(candidates) + '\n').encode()}


def produce(template_path, template_sha, policy_path, policy_sha, output):
    """Public inputs root-protected; mutable output NEW, no install/replay."""
    contract.hex_value(template_sha); contract.hex_value(policy_sha)
    template = sealed_policy.read_verified(str(template_path), template_sha)
    policy_raw = sealed_policy.read_verified(str(policy_path), policy_sha)
    def pairs(rows):
        value = {}
        for key, item in rows:
            if key in value: raise ValueError('duplicate_policy_key')
            value[key] = item
        return value
    policy = json.loads(policy_raw, object_pairs_hook=pairs,
                        parse_constant=lambda _: (_ for _ in ()).throw(ValueError('nonfinite_policy')))
    sealed_policy.verify_closure(policy)
    files = render(template, policy, policy['helpers']['sealed_policy.py']['sha256'])
    output = Path(output)
    if not output.is_absolute() or '..' in output.parts:
        raise ValueError('absolute_new_output_required')
    if not str(output).startswith('/mnt/apps/peticao-final/'):
        raise ValueError('project_output_only_no_install')
    parent = os.open('/', os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    outfd = -1
    try:
        for part in output.parent.parts[1:]:
            child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
            os.close(parent); parent = child
        os.mkdir(output.name, 0o700, dir_fd=parent)
        created = os.stat(output.name, dir_fd=parent, follow_symlinks=False)
        outfd = os.open(output.name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=parent)
        opened = os.fstat(outfd)
        identity = lambda i: (i.st_dev, i.st_ino, i.st_uid, stat.S_IMODE(i.st_mode))
        if identity(opened) != identity(created) or opened.st_uid != os.geteuid() or stat.S_IMODE(opened.st_mode) != 0o700:
            raise PermissionError('exclusive_owned_output_identity_required')
        for name, raw in files.items():
            fd = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600, dir_fd=outfd)
            with os.fdopen(fd, 'wb') as f:
                f.write(raw); f.flush(); os.fsync(f.fileno())
        os.fsync(outfd); os.fsync(parent)
        if (identity(os.stat(output.name, dir_fd=parent, follow_symlinks=False)) != identity(opened)
                or identity(os.stat(output, follow_symlinks=False)) != identity(opened)):
            raise PermissionError('output_directory_replaced_preserve_partial')
    finally:
        if outfd >= 0: os.close(outfd)
        os.close(parent)
    return {'version': 1, 'classification': 'PINNED_CANDIDATES_NOT_INSTALLED_NOT_QUALIFIED',
            'qualified': False, 'operationalReady': False,
            'files': {name: {'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw)} for name, raw in files.items()}}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for option in ('template', 'template-sha256', 'policy', 'policy-sha256', 'output'):
        parser.add_argument('--' + option, required=True)
    args = parser.parse_args()
    result = produce(args.template, args.template_sha256, args.policy, args.policy_sha256, args.output)
    print(json.dumps(result, sort_keys=True))


if __name__ == '__main__':
    try: main()
    except Exception as error:
        print(json.dumps({'ok': False, 'error_type': type(error).__name__}))
        raise SystemExit(1)
