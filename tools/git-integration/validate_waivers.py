#!/usr/bin/env python3
"""Allow only individually reviewed findings, never broad scanner exceptions."""
import json
import re
from pathlib import Path


def validate(repo):
    policy = json.loads((repo / 'tools/git-integration/publication-policy.json').read_text())
    rows = policy['gitleaks_waivers']
    allowed = {'cryptographic_provenance_digest_not_credential',
               'reviewed_isolated_authentication_test_fixture',
               'common_password_denylist_not_credential'}
    fingerprints = []
    for row in rows:
        assert row['classification'] in allowed and row['reason'].strip()
        value = row['fingerprint']
        assert re.fullmatch(r'[0-9a-f]{40}:[^\r\n*]+:[A-Za-z0-9_-]+:[0-9]+', value)
        fingerprints.append(value)
    assert len(set(fingerprints)) == len(fingerprints)
    actual = {line.strip() for line in (repo / '.gitleaksignore').read_text().splitlines()
              if line.strip() and not line.lstrip().startswith('#')}
    assert actual == set(fingerprints), 'unreviewed or missing scanner exception'
    # This repository uses the pinned scanner defaults and exact fingerprints.
    # A second config could silently disable a whole credential category.
    assert not (repo / '.gitleaks.toml').exists(), 'unexpected scanner config; requires explicit integration review'
    for row in policy['reviewed_cpf_fixture_blobs']:
        assert re.fullmatch('[0-9a-f]{40}', row['blob']) and row['reason'].strip()
        assert row['cpf_sha256'] and all(re.fullmatch('[0-9a-f]{64}', h) for h in row['cpf_sha256'])
    return {'pass': True, 'exact_reviewed_findings': len(fingerprints),
            'credential_category_exceptions': 0}


if __name__ == '__main__':
    print(json.dumps(validate(Path(__file__).resolve().parents[2])))
