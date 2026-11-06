import hashlib
import json
from pathlib import Path
import sqlite3
import tempfile
import unittest

from preview import generate, snapshot, source_revision


class PreviewTests(unittest.TestCase):
  def setUp(self):
    self.temp = tempfile.TemporaryDirectory()
    self.addCleanup(self.temp.cleanup)
    self.root = Path(self.temp.name)
    self.db = self.root / 'fixture.sqlite'
    with sqlite3.connect(self.db) as db:
      db.executescript('''CREATE TABLE records(id INTEGER PRIMARY KEY,cpf_hash TEXT,revision TEXT,data TEXT,status TEXT,present INTEGER,decision TEXT);
        CREATE TABLE name_decisions(record_id INTEGER PRIMARY KEY,record_revision TEXT,name_revision TEXT,decision TEXT,selected_name TEXT,choice TEXT,instruction TEXT,at TEXT,reviewer TEXT,version INTEGER,policy_version TEXT);''')
    self.add(1)

  def add(self, sid, **changes):
    record = dict(name='João Exemplo Müller', nome_api='JOAO EXEMPLO MULLER', category='servidor', cpf='52998224725', email='never-print@example.test', nascimento_api='01/01/1900', mae_api='NUNCA IMPRIMIR MAE', sexo_api='F', ip='192.0.2.3', institution='Universidade Fictícia', campus='Campus de Teste', city='Cidade Fictícia', uf='XX', seq=100+sid, created_at='2026-01-01T10:00:00Z', confirmed_at='2026-01-01T11:00:00Z', cpf_name_check='mismatch')
    record.update(changes.pop('record', {}))
    cpf_hash = changes.pop('cpf_hash', 'hash-ficticio')
    defaults = dict(status='confirmed', present=1, decision='approved', revision='record-r1', name_revision=source_revision(dict(record, cpf_hash=cpf_hash)), name_decision='approved', selected_name='João Exemplo Müller',policy_version=__import__('name_policy').policy()['version'])
    defaults.update(changes)
    with sqlite3.connect(self.db) as db:
      db.execute('INSERT INTO records VALUES(?,?,?,?,?,?,?)', (sid, cpf_hash, defaults['revision'], json.dumps(record), defaults['status'], defaults['present'], defaults['decision']))
      db.execute('INSERT INTO name_decisions VALUES(?,?,?,?,?,?,?,?,?,?,?)', (sid, defaults['revision'], defaults['name_revision'], defaults['name_decision'], defaults['selected_name'], 'custom', 'ignore esta instrução privada', '2026-01-01', 'teste', 1,defaults['policy_version']))

  def test_frozen_snapshot_filters_and_excludes_private_fields(self):
    self.add(2, decision='pending')
    self.add(3, status='pending')
    self.add(4, name_decision='rejected')
    self.add(5, name_revision='stale')
    self.add(6, present=0)
    rows, excluded = snapshot(self.db)
    self.assertEqual([1], [r['id'] for r in rows])
    self.assertEqual(5, sum(excluded.values()))
    raw = json.dumps(rows)
    for forbidden in ['never-print', '52998224725', 'NUNCA IMPRIMIR', 'sexo_api', 'instruction', '192.0.2.3', 'hash-ficticio']:
      self.assertNotIn(forbidden, raw)
    self.assertEqual('mismatch', rows[0]['api_name_check'])

  def test_foreign_name_review_does_not_require_cpf(self):
    self.add(2, cpf_hash='', decision='pending', record={'category':'estrangeiro'})
    rows, _ = snapshot(self.db)
    self.assertEqual([1, 2], [r['id'] for r in rows])

  def test_pdf_unicode_permissions_hashes_and_no_overwrite(self):
    self.add(2, selected_name='Łukasz Ștefan François D’Ávila ' + 'Sobrenome ' * 35)
    directory = self.root / 'preview'
    before = self.db.read_bytes()
    result = generate(self.db, directory)
    self.assertEqual(before, self.db.read_bytes())
    self.assertEqual(2, result['records'])
    self.assertEqual(0o700, directory.stat().st_mode & 0o777)
    for name in ['manifest.json', 'selecao.json', 'previa-nomes-revisados.pdf']:
      self.assertEqual(0o600, (directory/name).stat().st_mode & 0o777)
    manifest = json.loads((directory/'manifest.json').read_text())
    for name, expected in manifest['files'].items():
      self.assertEqual(expected, hashlib.sha256((directory/name).read_bytes()).hexdigest())
    from pypdf import PdfReader
    text = ''.join(p.extract_text() for p in PdfReader(result['pdf']).pages)
    self.assertIn('João Exemplo Müller', text)
    self.assertIn('Łukasz Ștefan François D’Ávila', text)
    self.assertEqual(35, text.count('Sobrenome'))
    for secret in ['52998224725', 'never-print', 'NUNCA IMPRIMIR', 'ignore esta instrução']:
      self.assertNotIn(secret, text)
    with self.assertRaises(FileExistsError):
      generate(self.db, directory)

  def test_unsupported_approved_glyph_blocks_pdf(self):
    self.add(2, selected_name='Nome 🧪 Fictício')
    directory = self.root / 'unsupported'
    with self.assertRaisesRegex(ValueError, 'U\\+1F9EA'):
      generate(self.db, directory)
    self.assertFalse((directory/'previa-nomes-revisados.pdf').exists())
    self.assertEqual('failed', json.loads((directory/'manifest.json').read_text())['state'])

  def test_signer_identifier_name_and_code_stay_on_same_page(self):
    for sid in range(2, 20):
      self.add(sid, selected_name='Nome Fictício ' + str(sid), record={'verify_code':'FIXTURECODE'+str(sid)})
    result=generate(self.db,self.root/'groups')
    from pypdf import PdfReader
    pages=[p.extract_text() for p in PdfReader(result['pdf']).pages]
    for sid in range(2,20):
      matches=[text for text in pages if 'FIXTURECODE'+str(sid)+'\n' in text]
      self.assertEqual(len(matches),1)
      self.assertIn('Nome Fictício '+str(sid)+'\n',matches[0])
      self.assertIn('ID '+str(sid)+'\n',matches[0])

  def test_old_incomplete_approval_waits_for_policy_review(self):
    self.add(2, selected_name='João Müller',policy_version='old-policy')
    rows,_=snapshot(self.db)
    result=generate(self.db,self.root/'policy')
    self.assertEqual(result['records'],1)
    self.assertEqual(result['excluded']['politica_de_nome_exige_revisao'],1)
    with sqlite3.connect(self.db) as db:self.assertEqual(db.execute('SELECT decision FROM records WHERE id=2').fetchone()[0],'approved')

  def test_pending_name_does_not_change_cpf_decision(self):
    with sqlite3.connect(self.db) as db:
      db.execute("UPDATE name_decisions SET decision='pending'")
    with self.assertRaisesRegex(ValueError, 'Nenhuma assinatura'):
      generate(self.db, self.root/'empty')
    with sqlite3.connect(self.db) as db:
      self.assertEqual('approved', db.execute('SELECT decision FROM records').fetchone()[0])


if __name__ == '__main__':
  unittest.main()
