"""Offline name/API/report tests. Never uses a real key, CPF dataset or network."""
import contextlib
import csv
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest
import urllib.error
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


compare = load('cpf_compare_tests', HERE / 'cpf_compare.py')
cycle = load('cycle_helper_validation_tests', HERE / 'cycle_worker.py')
full = load('export_full_validation_tests', HERE / 'export_full.py')
with patch.dict('sys.modules', {'cpf_compare': compare, 'cycle_worker': cycle}):
    worker = load('cpf_validation_worker_tests', HERE / 'cpf_validation_worker.py')
launcher = load('cpf_validation_launcher_tests', HERE.parent.parent / 'validar-cpfs.py')


class FakeResponse:
    status = 200

    def __init__(self, body):
        self.body = json.dumps(body).encode()

    def read(self, _limit):
        return self.body

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False


class NameTests(unittest.TestCase):
    def test_name_classes(self):
        cases = [
            ('Ana Maria Silva', 'Ana Maria Silva', 'coincidencia_exata', 'sim'),
            ('JOÃO   SOUZA', 'João Souza', 'coincidencia_normalizada', 'sim'),
            ('Ana da Silva', 'Ana Silva', 'variacao_de_particulas', 'sim'),
            ('Ana Silva', 'Ana Maria Silva', 'possivel_nome_incompleto_ou_abreviado', 'parcial'),
            ('Ana M. Silva', 'Ana Maria Silva', 'possivel_nome_incompleto_ou_abreviado', 'parcial'),
            ('Ana Maria Silve', 'Ana Maria Silva', 'possivel_erro_de_digitacao', 'parcial'),
            ('Silva Ana Maria', 'Ana Maria Silva', 'ordem_diferente', 'parcial'),
            ('Carlos Pereira', 'Ana Maria Silva', 'divergencia_forte', 'nao'),
            ('Ana Maria Santos', 'Ana Maria Silva', 'divergencia_relevante', 'nao'),
            ('Ana', 'Ana Maria Silva', 'nome_insuficiente', 'inconclusivo'),
            ('Ana', 'Ana', 'nome_insuficiente', 'inconclusivo'),
        ]
        for original, returned, kind, matches in cases:
            with self.subTest(original=original, returned=returned):
                result = compare.compare(original, returned)
                self.assertEqual(result['nome_classificacao'], kind)
                self.assertEqual(result['nome_confere'], matches)
                self.assertNotIn(result['indicacao_titularidade'], ('identidade_comprovada', 'cpf_de_outra_pessoa_comprovado'))

    def test_differences_and_valid_cpf(self):
        result = compare.compare('Ana Silva', 'Ana Maria Silva')
        self.assertEqual(result['palavras_ausentes_no_informado'], 'maria')
        self.assertTrue(compare.cpf_valid('52998224725'))
        self.assertTrue(compare.cpf_valid('00000000191'))
        for invalid in ('11111111111', '00000000000', '52998224724', '529.982.247-25', '５２９９８２２４７２５'):
            self.assertFalse(compare.cpf_valid(invalid))


class ApiTests(unittest.TestCase):
    def test_response_fields_and_header(self):
        class Opener:
            def open(self, request, timeout):
                self.request, self.timeout = request, timeout
                return FakeResponse({'success': True, 'data': {'CPF': '529.982.247-25', 'NOME': 'Ana Maria Silva',
                                                             'NASC': '15/08/1985', 'NOME_MAE': 'Pessoa Fictícia', 'SEXO': 'Feminino'}})
        opener = Opener()
        record, halt = worker.fetch('52998224725', 'fake-key-not-real', opener)
        self.assertFalse(halt)
        self.assertEqual(record['status'], 'ok')
        self.assertEqual(record['birth'], '15/08/1985')
        self.assertEqual(record['mother'], 'Pessoa Fictícia')
        self.assertEqual(record['sex'], 'Feminino')
        self.assertEqual(opener.request.get_header('X-api-key'), 'fake-key-not-real')
        self.assertNotIn('fake-key-not-real', opener.request.full_url)

    def test_wrong_cpf_never_associated_with_name(self):
        class Opener:
            def open(self, *_args, **_kwargs):
                return FakeResponse({'data': {'CPF': '00000000191', 'NOME': 'Outra Pessoa'}})
        record, halt = worker.fetch('52998224725', 'fake', Opener())
        self.assertTrue(halt)
        self.assertEqual(record['status'], 'resposta_cpf_divergente')
        self.assertNotIn('name', record)

    def test_quota_error_stops_and_network_error_is_inconclusive(self):
        class Quota:
            def open(self, *_args, **_kwargs):
                raise urllib.error.HTTPError('https://example.invalid', 402, 'fake', {}, io.BytesIO(b'{"code":"QUOTA_EXCEEDED"}'))
        record, halt = worker.fetch('52998224725', 'fake', Quota())
        self.assertTrue(halt)
        self.assertEqual(record['error_code'], 'QUOTA_EXCEEDED')
        class Network:
            def open(self, *_args, **_kwargs):
                raise TimeoutError('must not be printed')
        record, halt = worker.fetch('52998224725', 'fake', Network())
        self.assertTrue(halt)
        self.assertEqual(record['status'], 'erro_indeterminado')

    def test_no_redirect_and_absent_name(self):
        self.assertIsNone(worker.NoRedirect().redirect_request(None, None, None, None, None, None))
        class Opener:
            def open(self, *_args, **_kwargs):
                return FakeResponse({'success': True, 'data': {'NASC': '15/08/1985'}})
        record, halt = worker.fetch('52998224725', 'fake', Opener())
        self.assertTrue(halt)
        self.assertEqual(record['error_code'], 'EMPTY_NAME')


class ReportTests(unittest.TestCase):
    def setup_job(self, root, same_cpf=True):
        job = root / 'job'
        job.mkdir(mode=0o700)
        inputs = []
        for number, group in enumerate(('confirmadas', 'pendentes')):
            row = dict.fromkeys(full.HEADERS, '')
            row.update(assinatura_id=str(number+1), nome='Ana Silva' if number == 0 else 'Carlos Pereira',
                       cpf='52998224725' if same_cpf or number == 0 else '00000000191', email='fake@example.org',
                       criado_em='2026-01-02T03:04:05.000Z', consentimento_em='original-consent',
                       confirmado_em='original-confirmation' if number == 0 else '')
            name = 'entrada-' + group + '.csv'
            with (job / name).open('w', encoding='utf-8-sig', newline='') as stream:
                out = csv.DictWriter(stream, fieldnames=full.HEADERS)
                out.writeheader(); out.writerow(row)
            inputs.append(dict(group=group, source_name='original-' + group + '.csv', file=name, rows=1,
                               sha256=hashlib.sha256((job / name).read_bytes()).hexdigest()))
        (job / 'inputs.json').write_text(json.dumps(inputs))
        return job

    def test_cohort_preservation_deduplication_cache_and_full_report(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            job = self.setup_job(root)
            originals = {path: path.read_bytes() for path in job.glob('entrada-*.csv')}
            cache = root / 'cache.sqlite'

            def response(cpf, _key):
                with sqlite3.connect(cache) as conn:
                    self.assertEqual(conn.execute('SELECT status FROM lookups WHERE cpf=?', (cpf,)).fetchone()[0],
                                     'consulta_interrompida_ou_indeterminada')
                return dict(cpf=cpf, status='ok', queried_at='2026-01-03T00:00:00+00:00', name='Ana Maria Silva',
                            birth='15/08/1985', mother='Mãe Fictícia', sex='F', returned_cpf=cpf, http_status=200), False

            with patch.object(worker, 'CACHE', cache), patch.object(worker, 'read_key', return_value='fake'), \
                 patch.object(worker, 'fetch', side_effect=response) as fetch, \
                 patch.object(worker.time, 'sleep'), patch.object(worker.signal, 'signal'), \
                 contextlib.redirect_stdout(io.StringIO()):
                worker.work(job)
                worker.work(job)
            self.assertEqual(fetch.call_count, 1)
            for path, content in originals.items():
                self.assertEqual(path.read_bytes(), content)
            with (job / 'resultados/comparacao-cpf-brasil-todas.csv').open(encoding='utf-8-sig', newline='') as stream:
                reader = csv.DictReader(stream)
                rows = list(reader)
                self.assertEqual(len(reader.fieldnames), len(full.HEADERS) + len(worker.EXTRA))
            self.assertEqual(len(rows), 2)
            self.assertEqual(rows[0]['nome'], 'Ana Silva')
            self.assertEqual(rows[0]['nome_retornado'], 'Ana Maria Silva')
            self.assertEqual(rows[0]['nome_classificacao'], 'possivel_nome_incompleto_ou_abreviado')
            self.assertEqual(rows[1]['nome_classificacao'], 'divergencia_forte')
            self.assertEqual(rows[1]['confirmado_em'], '')
            self.assertEqual(rows[0]['criado_em'], '2026-01-02T03:04:05.000Z')
            self.assertEqual(rows[0]['sexo_normalizado'], 'Feminino')
            self.assertEqual(rows[0]['nascimento_confere'], 'nao_comparavel_nao_coletado')
            self.assertEqual(rows[0]['verificacao_governamental'], 'nao_realizada')
            summary = json.loads((job / 'status.json').read_text())
            self.assertEqual(summary['phase'], 'complete')
            self.assertEqual(summary['cpfs_distintos'], 1)
            output = root / 'download'
            launcher.unpack_verified(job / 'resultados-validacao.tar.gz', output)
            with sqlite3.connect(output / 'comparacao-cpf-brasil.sqlite') as conn:
                self.assertEqual(conn.execute('SELECT count(*) FROM resultados').fetchone()[0], 2)

    def test_quota_partial_export_does_not_claim_name_mismatch(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            job = self.setup_job(root, same_cpf=False)
            with patch.object(worker, 'CACHE', root / 'cache.sqlite'), \
                 patch.object(worker, 'read_key', return_value='fake'), \
                 patch.object(worker, 'fetch', return_value=({'cpf': '52998224725', 'status': 'erro_consulta',
                                                            'error_code': 'QUOTA_EXCEEDED', 'queried_at': 'test'}, True)) as fetch, \
                 patch.object(worker.time, 'sleep'), patch.object(worker.signal, 'signal'), \
                 contextlib.redirect_stdout(io.StringIO()):
                worker.work(job)
            self.assertEqual(fetch.call_count, 1)
            summary = json.loads((job / 'status.json').read_text())
            self.assertEqual(summary['phase'], 'partial')
            with (job / 'resultados/comparacao-cpf-brasil-todas.csv').open(encoding='utf-8-sig', newline='') as stream:
                rows = list(csv.DictReader(stream))
            self.assertEqual(rows[0]['nome_confere'], 'inconclusivo')
            self.assertEqual(rows[1]['consulta_status'], 'nao_consultado')

    def test_interrupted_request_not_automatically_billed_again(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            job = self.setup_job(root)
            with patch.object(worker, 'CACHE', root / 'cache.sqlite'), \
                 patch.object(worker, 'read_key', return_value='fake'), \
                 patch.object(worker, 'fetch', side_effect=RuntimeError('simulated crash')) as fetch, \
                 patch.object(worker.time, 'sleep'), patch.object(worker.signal, 'signal'), \
                 contextlib.redirect_stdout(io.StringIO()):
                with self.assertRaises(RuntimeError):
                    worker.work(job)
                worker.work(job)
            self.assertEqual(fetch.call_count, 1)
            self.assertEqual(json.loads((job / 'status.json').read_text())['phase'], 'partial')

    def test_inputs_changes_detected(self):
        with tempfile.TemporaryDirectory() as temp:
            job = self.setup_job(Path(temp))
            (job / 'entrada-confirmadas.csv').write_text('changed')
            with self.assertRaises(RuntimeError):
                worker.load_inputs(job)

    def test_bundle_matches_sources(self):
        for name, content in launcher.bundle().items():
            self.assertEqual(content, (HERE / name).read_text())


if __name__ == '__main__':
    unittest.main()
