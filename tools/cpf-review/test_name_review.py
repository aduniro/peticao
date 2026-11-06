import json,sqlite3,unittest
from unittest.mock import patch
from test_data import ReviewTests
from name_review import schema,get_names,decide_name,bulk_preview,bulk_apply,bulk_undo,instructions

# Inherit the isolated fake-data fixture, never touch the real review database.
class NameReviewTests(ReviewTests):
 def setUp(self):
  super().setUp()
  with sqlite3.connect(self.db) as db:schema(db)
 def stub(self,record):
  return dict(entered_resolved=record['name'],api_resolved=record.get('nome_api'),proposed=record['name'],special=False,alternatives=[],reasons=[],dictionary_version='fixture-v1')
 def test_independent_rejection_instruction_and_literal(self):
  with patch('name_dictionary.suggest',self.stub):
   n=get_names(101,self.db);before=self.item()
   decide_name(101,dict(n,decision='rejected',choice='entered',instruction='Confira o acento'), 'tester',self.db)
   self.assertEqual(self.item()['decision'],before['decision']);self.assertEqual(get_names(101,self.db)['decision'],'rejected')
   self.assertEqual(instructions(self.db)['records'][0]['instruction'],'Confira o acento')
   n=get_names(101,self.db)
   with self.assertRaises(ValueError):decide_name(101,dict(n,decision='approved',choice='custom',literal='Maria Exemplo Silva'), 'tester',self.db)
   decide_name(101,dict(n,decision='approved',choice='custom',literal='María Exemplo Silva',instruction=''), 'tester',self.db)
   self.assertEqual(get_names(101,self.db)['selected_name'],'María Exemplo Silva')
 def test_name_staleness_preserves_old_choice_but_requires_review(self):
  with patch('name_dictionary.suggest',self.stub):
   n=get_names(101,self.db);decide_name(101,dict(n,decision='approved',choice='entered'), 'tester',self.db)
   self.row['name']='Maria Exemplo Silva Júnior';self.write();from data import ingest;ingest(self.source,self.db)
   new=get_names(101,self.db);self.assertTrue(new['stale']);self.assertEqual(new['decision'],'pending');self.assertEqual(new['selected_name'],'Maria Exemplo Silva')
   with self.assertRaises(RuntimeError):decide_name(101,dict(n,decision='approved'), 'tester',self.db)
 def test_bulk_both_kinds_undo_and_reuse(self):
  with patch('name_dictionary.suggest',self.stub):
   for kind in ['name','cpf']:
    preview=bulk_preview(dict(kind=kind,decision='approved',filters=dict(view='all',group=self.item()['classification'])),self.db)
    self.assertEqual(preview['count'],1);applied=bulk_apply(preview['token'],'tester',self.db)
    with self.assertRaises(ValueError):bulk_apply(preview['token'],'tester',self.db)
    bulk_undo(applied['batch_id'],'tester',self.db)
    self.assertEqual(self.item()['decision'],'pending');self.assertEqual(get_names(101,self.db)['decision'],'pending')
 def test_bulk_does_not_overwrite_newer_name_decision(self):
  with patch('name_dictionary.suggest',self.stub):
   preview=bulk_preview(dict(kind='name',decision='approved',filters=dict(view='all',group=self.item()['classification'])),self.db)
   n=get_names(101,self.db);decide_name(101,dict(n,decision='rejected',choice='entered'), 'tester',self.db)
   with self.assertRaises(RuntimeError):bulk_apply(preview['token'],'tester',self.db)
   self.assertEqual(get_names(101,self.db)['decision'],'rejected')
 def test_special_excluded_and_missing_category_rejected(self):
  with patch('name_dictionary.suggest',lambda r:dict(self.stub(r),special=True)):
   preview=bulk_preview(dict(kind='name',decision='approved',filters=dict(view='all',group=self.item()['classification'])),self.db)
   self.assertEqual(preview['count'],0);self.assertEqual(preview['skipped'],1)
   with self.assertRaises(ValueError):bulk_preview(dict(kind='cpf',decision='approved',filters={}),self.db)
 def test_no_personal_data_in_notes_export_beyond_name(self):
  with patch('name_dictionary.suggest',self.stub):
   n=get_names(101,self.db);decide_name(101,dict(n,decision='pending',instruction='Usar o nome completo'), 'tester',self.db)
   value=json.dumps(instructions(self.db));self.assertNotIn('52998224725',value);self.assertNotIn('MAE FICTICIA',value)
 def test_unicode_only_changes_still_stale_print_name(self):
  with patch('name_dictionary.suggest',self.stub):
   n=get_names(101,self.db);decide_name(101,dict(n,decision='approved',choice='entered'), 'tester',self.db)
   self.row['name']='María Exemplo Silva';self.write();from data import ingest;ingest(self.source,self.db)
   self.assertEqual(self.item()['revision'],n['revision']);self.assertTrue(get_names(101,self.db)['stale'])
 def test_foreigners_not_skipped_and_do_not_inherit_empty_hash(self):
  self.row.update(category='estrangeiro',cpf_hash=None,name='Seán Exemple');self.write();from data import ingest;ingest(self.source,self.db)
  self.assertEqual(self.item()['classification'],'estrangeiro_sem_cpf')

 def test_bulk_freezes_all_pages_and_rolls_back_on_last_stale_row(self):
  with patch('name_dictionary.suggest',self.stub):
   with sqlite3.connect(self.db) as db:
    for sid in range(102,163):
     db.execute("INSERT INTO records SELECT ?,cpf_hash,revision,data,classification,priority,search,status,decision,decision_origin,present,updated_at FROM records WHERE id=101",(sid,))
   group=self.item()['classification']
   preview=bulk_preview(dict(kind='cpf',decision='approved',filters=dict(view='all',group=group)),self.db)
   self.assertEqual(preview['count'],62)
   with sqlite3.connect(self.db) as db:db.execute("UPDATE records SET revision='changed' WHERE id=162")
   with self.assertRaises(RuntimeError):bulk_apply(preview['token'],'tester',self.db)
   with sqlite3.connect(self.db) as db:
    self.assertEqual(db.execute("SELECT count(*) FROM records WHERE decision='approved'").fetchone()[0],0)
    self.assertEqual(db.execute('SELECT count(*) FROM decisions').fetchone()[0],0)
   preview=bulk_preview(dict(kind='cpf',decision='approved',filters=dict(view='all',group=group)),self.db)
   applied=bulk_apply(preview['token'],'tester',self.db);self.assertEqual(applied['count'],62)
   bulk_undo(applied['batch_id'],'tester',self.db)
   with sqlite3.connect(self.db) as db:self.assertEqual(db.execute("SELECT count(*) FROM records WHERE decision='pending'").fetchone()[0],62)

 def test_ai_import_is_separate_versioned_and_never_approves(self):
  from name_instructions import import_proposals
  with patch('name_dictionary.suggest',self.stub):
   n=get_names(101,self.db);request=dict(id=101,revision=n['revision'],name_revision=n['name_revision'],version=n['version'],literal='María Exemplo Silva',explanation='Acento conforme instrução.',uncertainty='Grafia civil não comprovada.')
   import_proposals([request],self.db)
   self.assertEqual(get_names(101,self.db)['decision'],'pending');self.assertEqual(get_names(101,self.db)['ai_proposal']['literal'],request['literal'])
   decide_name(101,dict(n,decision='rejected',choice='entered'),'tester',self.db)
   self.assertIsNone(get_names(101,self.db)['ai_proposal'])
   with self.assertRaises(ValueError):import_proposals([request],self.db)
