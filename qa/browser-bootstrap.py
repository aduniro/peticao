"""Fixed -I -S -B bootstrap: verified extracted wheels only, no site/.pth/env path."""
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import stat
import sys

TOOLS = Path('/opt/peticao-dev-profile-tools-v1')
WHEELS = frozenset({'greenlet-3.5.6-cp312-cp312-manylinux_2_24_x86_64.manylinux_2_28_x86_64.whl',
                   'playwright-1.62.0-py3-none-manylinux1_x86_64.whl', 'pyee-13.0.1-py3-none-any.whl',
                   'typing_extensions-4.16.0-py3-none-any.whl'})


def trusted(path, directory=False):
    path = Path(path).absolute()
    for parent in [*reversed(path.parents), path]:
        i = parent.lstat()
        if stat.S_ISLNK(i.st_mode) or i.st_uid != 0 or i.st_mode & 0o022:
            raise PermissionError('root_readonly_browser_runtime_required')
    i = path.lstat()
    if (directory and not stat.S_ISDIR(i.st_mode)) or (not directory and (not stat.S_ISREG(i.st_mode) or i.st_nlink != 1)):
        raise PermissionError('regular_browser_runtime_required')
    return path


def pinned(path, row):
    if type(row) is not dict or set(row) != {'sha256', 'bytes'} or type(row['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}', row['sha256']) or type(row['bytes']) is not int or not 0 <= row['bytes'] <= 536870912:
        raise ValueError('exact_browser_runtime_file_pin_required')
    path = trusted(path)
    if path.stat().st_size != row['bytes']:
        raise PermissionError('browser_runtime_size_changed')
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        while block := stream.read(1048576):
            digest.update(block)
    if digest.hexdigest() != row['sha256']:
        raise PermissionError('browser_runtime_hash_changed')


def validate_runtime(value, tools=TOOLS):
    if type(value) is not dict or set(value) != {'version', 'site_root', 'source_wheels', 'files'} or type(value['version']) is not int or value['version'] != 1:
        raise ValueError('exact_python_runtime_inventory_required')
    site = Path(tools) / 'python-wheels/site'
    if value['site_root'] != str(site) or type(value['files']) is not dict or not 1 <= len(value['files']) <= 20000:
        raise PermissionError('complete_extracted_wheel_inventory_pending')
    trusted(site, True)
    rows = value['source_wheels']
    if type(rows) is not list or len(rows) != 4 or any(type(row) is not dict or set(row) != {'name', 'sha256', 'bytes'} for row in rows) or {row['name'] for row in rows} != WHEELS:
        raise ValueError('exact_four_source_wheels_required')
    for row in rows:
        if type(row['bytes']) is not int or row['bytes'] <= 0:
            raise ValueError('nonempty_source_wheel_required')
        pinned(Path(tools) / 'python-wheels' / row['name'], {k: row[k] for k in ('sha256', 'bytes')})
    actual = set()
    for item in site.rglob('*'):
        i = item.lstat()
        if stat.S_ISLNK(i.st_mode) or not (stat.S_ISDIR(i.st_mode) or stat.S_ISREG(i.st_mode)):
            raise PermissionError('wheel_runtime_links_and_special_files_forbidden')
        if item.is_file():
            name = item.relative_to(site).as_posix()
            if item.suffix in {'.pth', '.pyc'} or '__pycache__' in item.parts:
                raise PermissionError('no_site_pth_or_mutable_python_cache')
            actual.add(name)
    if actual != set(value['files']):
        raise PermissionError('exact_extracted_python_runtime_files_required')
    for name, row in value['files'].items():
        if type(name) is not str or not name or Path(name).is_absolute() or '..' in Path(name).parts or name != Path(name).as_posix():
            raise ValueError('canonical_wheel_member_required')
        pinned(site / name, row)
    return site


def main():
    if Path(__file__).absolute() != TOOLS / 'qa/browser-bootstrap.py' or len(sys.argv) < 2 or sys.argv[1] not in {'browser40', 'maps2'}:
        raise PermissionError('fixed_browser_entry_required')
    if not sys.flags.isolated or not sys.flags.no_site or not sys.dont_write_bytecode:
        raise PermissionError('isolated_no_site_no_bytecode_required')
    manifest = trusted(TOOLS / 'qa/python-runtime.json')
    if manifest.stat().st_size > 4194304:
        raise ValueError('bounded_python_runtime_manifest_required')
    site = validate_runtime(json.loads(manifest.read_text()))
    if os.environ.get('PLAYWRIGHT_NODEJS_PATH') != str(TOOLS / 'node20'):
        raise PermissionError('pinned_playwright_node_required')
    script = trusted(TOOLS / ('qa/' + sys.argv[1] + '.py'))
    sys.path.insert(0, str(site))
    sys.argv = [str(script), *sys.argv[2:]]
    runpy.run_path(str(script), run_name='__main__')


if __name__ == '__main__':
    main()
