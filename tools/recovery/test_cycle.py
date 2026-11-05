"""Offline end-to-end checks: no production data, credentials or networking."""
import contextlib
import hashlib
import hmac
import importlib.util
import io
import json
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tarfile
import tempfile
import types
import unittest
from unittest.mock import patch


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


HERE = Path(__file__).resolve().parent
worker = module('cycle_worker_test', HERE / 'cycle_worker.py')
launcher = module('cycle_launcher_test', HERE.parent.parent / 'atualizar-cpfs.py')
confirmed = module('confirmed_engine', HERE / 'recover_cpfs.py')
pending = module('pending_engine', HERE / 'recover_pending_cpfs.py')
full = module('full_export_cycle_test', HERE / 'export_full.py')


class CycleTests(unittest.TestCase):
    def test_self_contained_bundle_matches_sources(self):
        for name, content in launcher.bundle().items():
            self.assertEqual(content, (HERE / name).read_text())

    def test_full_cycle_twice_with_backups_and_downloads(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            remote, destination, source = root / 'vps', root / 'cpfs', root / 'peticao'
            remote.mkdir(mode=0o700)
            source.mkdir(mode=0o700)
            original = remote / 'assinaturas.sqlite'
            with sqlite3.connect(original) as conn:
                conn.execute('CREATE TABLE original(value TEXT)')
                conn.execute("INSERT INTO original VALUES('fictional')")
            (remote / 'antigo.csv').write_text('cpf\n00000000191\n')
            (source / 'antigo.csv').write_text('cpf\n00000000191\n')
            original_bytes = original.read_bytes()
            original_csv = (source / 'antigo.csv').read_bytes()
            key = b'fictional-test-secret-not-for-production-0123456789'
            calls = []

            def row_for(group):
                base = 1 if group == 'confirmadas' else 2
                cpf = confirmed.cpf_from_base(base)
                return dict(id=base, name='Pessoa Fictícia ' + group, category='apoiador',
                            cpf_hash=hmac.new(key, cpf, hashlib.sha256).hexdigest(), cpf_name_check=None,
                            created_at='2026-11-01T01:02:03.000Z', consent_at='original-consent',
                            confirmed_at='original-confirmation' if base == 1 else None)

            def forms(path):
                group = 'confirmadas' if 'confirmadas' in path.name else 'pendentes'
                row = row_for(group)
                return [dict(assinatura_id=row['id'], nome=row['name'], email='fictional@example.org',
                             categoria='apoiador', criado_em=row['created_at'],
                             consentimento_em=row['consent_at'], confirmado_em=row['confirmed_at'])]

            def engines(command, **kwargs):
                name = Path(command[1]).name
                self.assertIn(name, ('recover_cpfs.py', 'recover_pending_cpfs.py'))
                engine = confirmed if name == 'recover_cpfs.py' else pending
                group = 'confirmadas' if engine is confirmed else 'pendentes'
                calls.append((group, '--max-candidates' in command))
                with patch('sys.argv', command[1:]), \
                     patch.object(engine, 'read_settings', return_value=(key, 'peticao', '5432')), \
                     patch.object(engine, 'snapshot', return_value=[row_for(group)]):
                    engine.main()
                return types.SimpleNamespace(returncode=0)

            def fake_ssh(*args, capture=False):
                if args[:2] == ('id', '-u'):
                    return '0\n'
                if args[0] == 'install':
                    Path(args[-1]).mkdir(parents=True, exist_ok=True, mode=0o700)
                    return ''
                self.assertEqual(args[0], 'python3')
                phase, run_id = args[2:]
                job = Path(args[1]).parent
                if phase == 'backup':
                    worker.backup(run_id)
                elif phase == 'launch':
                    # The launcher must have verified/downloaded old remote data
                    # locally before even one new recovery engine is executed.
                    self.assertTrue((destination / 'backups' / run_id / 'vps' / 'manifest.json').exists())
                    worker.recover(run_id, job)
                elif phase == 'status':
                    path = job / 'status.json'
                    value = json.loads(path.read_text()) if path.exists() else {'phase': 'waiting'}
                    value['active'] = False
                    return json.dumps(value)
                else:
                    self.fail('Unexpected SSH action')
                return ''

            def fake_transfer(command, capture=False):
                self.assertEqual(command[0], 'scp')
                sources, target = command[1:-1], command[-1]
                if target.startswith('peticao-root:'):
                    target = target.split(':', 1)[1]
                    for path in sources:
                        shutil.copyfile(path, Path(target) / Path(path).name)
                else:
                    self.assertEqual(len(sources), 1)
                    shutil.copyfile(sources[0].split(':', 1)[1], target)
                return ''

            real_stat = Path.stat

            def stat_root(path, *args, **kwargs):
                result = real_stat(path, *args, **kwargs)
                return types.SimpleNamespace(st_uid=0, st_mode=result.st_mode,
                                             st_size=result.st_size, st_mtime_ns=result.st_mtime_ns)

            with patch.object(worker, 'BASE', remote), \
                 patch.object(launcher, 'DESTINATION', destination), \
                 patch.object(launcher, 'STATE', destination / '.atualizacao-em-andamento.json'), \
                 patch.object(launcher, 'REMOTE', str(remote)), \
                 patch.object(launcher, 'HERE', source), \
                 patch.object(launcher, 'ssh', side_effect=fake_ssh), \
                 patch.object(launcher, 'run', side_effect=fake_transfer), \
                 patch.object(worker, 'query_forms', side_effect=forms), \
                 patch.object(worker.subprocess, 'run', side_effect=engines), \
                 patch.object(confirmed.os, 'geteuid', return_value=0), \
                 patch.object(confirmed.os, 'nice'), \
                 patch.object(confirmed.resource, 'setrlimit'), \
                 patch.object(Path, 'stat', side_effect=stat_root, autospec=True), \
                 patch.dict('sys.modules', {'export_full': full}), \
                 patch('sys.argv', ['atualizar-cpfs.py']), \
                 contextlib.redirect_stdout(io.StringIO()):
                launcher.main()
                first_state = json.loads(launcher.STATE.read_text())
                self.assertEqual(first_state['phase'], 'complete')
                first_results = sorted(destination.glob('*.sqlite')) + sorted(destination.glob('*.csv'))
                self.assertEqual(len(first_results), 8)
                first_hashes = {p: hashlib.sha256(p.read_bytes()).hexdigest() for p in first_results}
                launcher.main()
                self.assertEqual(len(list(destination.glob('*.sqlite'))) + len(list(destination.glob('*.csv'))), 16)
                for path, digest in first_hashes.items():
                    self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest)
                self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in first_results))
            self.assertEqual(original.read_bytes(), original_bytes)
            self.assertEqual((source / 'antigo.csv').read_bytes(), original_csv)
            self.assertEqual(calls[:4], [('confirmadas', True), ('pendentes', True), ('confirmadas', False), ('pendentes', False)])
            for path in destination.glob('assinaturas-pendentes-*.sqlite'):
                with sqlite3.connect(path) as conn:
                    self.assertEqual(conn.execute('SELECT original_confirmed_at FROM signatures').fetchone()[0], None)

    def test_download_rejects_corruption_before_extracting_results(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            file = root / 'example.csv'
            file.write_text('cpf\n00000000191\n')
            archive = root / 'backup.tar.gz'
            worker.package(root, [file], archive)
            with tarfile.open(archive, 'r:gz') as src:
                data = {member.name: src.extractfile(member).read() for member in src.getmembers()}
            data['example.csv'] = b'corrupted'
            bad = root / 'bad.tar.gz'
            with tarfile.open(bad, 'w:gz') as dst:
                for name, content in data.items():
                    member = tarfile.TarInfo(name)
                    member.size = len(content)
                    dst.addfile(member, io.BytesIO(content))
            output = root / 'output'
            with self.assertRaises(RuntimeError):
                launcher.unpack_verified(bad, output)
            self.assertEqual(list(output.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
