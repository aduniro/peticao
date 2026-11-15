"""Only fixture profiles. Future real build/QA profiles need separate approval."""
import json
from pathlib import Path
import sys


def main():
    if len(sys.argv)!=2 or sys.argv[1] not in {'fixture-pass','fixture-fail'}:raise ValueError('fixed_fixture_profile_required')
    profile=sys.argv[1];code=0 if profile=='fixture-pass' else 7
    Path('tmp').mkdir(mode=0o700)
    Path('artifacts').mkdir(mode=0o700)
    Path('artifacts/fixture.txt').write_text('synthetic development worker fixture\n')
    Path('output.log').write_text('synthetic fixture finished\n')
    Path('result.json').write_text(json.dumps({'protocol':1,'profile':profile,'exit_code':code}))
    return code


if __name__=='__main__':raise SystemExit(main())
