import json,sqlite3,tempfile,unittest,threading
from unittest.mock import patch
from pathlib import Path
from data import connect,decide,ingest,listing

class ReviewFixture:
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.root=Path(self.temp.name);self.db=self.root/'review.sqlite';self.source=self.root/'source';self.source.mkdir()
  self.row={'id':101,'seq':None,'name':'Maria Exemplo Silva','cpf_hash':'a'*64,'status':'pending','category':'apoiador'}
  self.write()
  with sqlite3.connect(self.source/'recuperacao.sqlite') as c:c.execute('CREATE TABLE signatures(cpf_hash TEXT,cpf TEXT)');c.execute('INSERT INTO signatures VALUES(?,?)',('a'*64,'52998224725'))
  with sqlite3.connect(self.source/'consultas.sqlite') as c:c.execute('CREATE TABLE lookups(cpf TEXT)')
  ingest(self.source,self.db)
 def write(self):
  (self.source/'signatures.json').write_text(json.dumps({'at':'2026-11-06T12:00:00Z','signatures':[self.row]}))
  (self.source/'cache.json').write_text(json.dumps({'records':[{'hash':'a'*64,'status':'ok','name':'JOSE OUTRO TESTE','mother':'MAE FICTICIA','birth':'01/01/1980','sex':'M','queried_at':'2026-11-05T12:00:00Z'}]}))
 def tearDown(self):self.temp.cleanup()
 def item(self,view='all'):return listing({'view':view},self.db)['rows'][0]

class ReviewTests(ReviewFixture,unittest.TestCase):
 def test_reject_hides_without_deleting_and_can_restore(self):
  row=self.item();decide(101,'rejected',row['revision'],'teste',self.db)
  self.assertEqual(listing({'view':'active'},self.db)['total'],0)
  self.assertEqual(self.item('rejected')['name'],'Maria Exemplo Silva')
  decide(101,'approved',row['revision'],'teste',self.db)
  self.assertEqual(self.item()['status'],'pending')
  with connect(self.db) as c:self.assertEqual(c.execute('SELECT count(*) FROM decisions').fetchone()[0],2)
 def test_refresh_preserves_manual_rejection(self):
  row=self.item();decide(101,'rejected',row['revision'],'teste',self.db);ingest(self.source,self.db)
  self.assertEqual(self.item()['decision'],'rejected')
 def test_new_data_requires_review_without_losing_history(self):
  row=self.item();decide(101,'approved',row['revision'],'teste',self.db)
  self.row['name']='Maria Outro Nome';self.write();ingest(self.source,self.db)
  self.assertEqual(self.item()['decision'],'pending')
  with self.assertRaises(RuntimeError):decide(101,'approved',row['revision'],'teste',self.db)
 def test_recreated_id_keeps_manual_rejection_and_old_record(self):
  row=self.item();decide(101,'rejected',row['revision'],'teste',self.db)
  self.row['id']=202;self.write();ingest(self.source,self.db)
  rows=listing({'view':'rejected'},self.db)['rows'];self.assertEqual(len(rows),2)
  self.assertEqual({r['id'] for r in rows},{101,202});self.assertTrue(all(r['decision']=='rejected' for r in rows))
 def test_query_is_parameterized_and_raw_data_stays_intact(self):
  self.assertEqual(listing({'view':'all','q':"' OR 1=1 --"},self.db)['total'],0)
  row=self.item();self.assertEqual(row['cpf'],'52998224725');self.assertEqual(row['mae_api'],'MAE FICTICIA');self.assertIsNone(row['mae_informada'])
  with self.assertRaises(ValueError):decide(101,'delete',row['revision'],'teste',self.db)

 def test_enrichment_and_rules_do_not_reset_name_review(self):
  row=self.item();decide(101,'approved',row['revision'],'teste',self.db)
  data=json.loads((self.source/'cache.json').read_text());data['records'][0].update(birth='02/02/1980',mother='MAE ATUALIZADA',sex='F',queried_at='2026-11-06T12:00:00Z')
  (self.source/'cache.json').write_text(json.dumps(data))
  source=json.loads((self.source/'signatures.json').read_text());source.update(validation_version='nova-regra-na-vps',read_only=True);source['signatures'][0].update(category='servidor',institution='Universidade Exemplo',campus='Campus Exemplo',role='docente',status='confirmed',seq=55,identity_method='nascimento')
  (self.source/'signatures.json').write_text(json.dumps(source));ingest(self.source,self.db)
  current=self.item();self.assertEqual(current['decision'],'approved');self.assertEqual(current['revision'],row['revision']);self.assertEqual(current['mae_api'],'MAE ATUALIZADA');self.assertEqual(current['identity_method'],'nascimento');self.assertEqual(current['category'],'servidor')
  with connect(self.db) as c:self.assertEqual(c.execute('SELECT count(*) FROM decisions').fetchone()[0],1)
 def test_expired_or_missing_cache_preserves_evidence_and_rejection(self):
  row=self.item();decide(101,'rejected',row['revision'],'teste',self.db)
  (self.source/'cache.json').write_text(json.dumps({'records':[]}));ingest(self.source,self.db)
  current=self.item();self.assertEqual(current['decision'],'rejected');self.assertEqual(current['nome_api'],row['nome_api']);self.assertEqual(current['mae_api'],row['mae_api']);self.assertFalse(current['api_cache_ativo']);self.assertTrue(current['api_evidencia_historica'])
 def test_newer_historical_response_is_not_reported_as_active_cache(self):
  with sqlite3.connect(self.source/'consultas.sqlite') as c:
   for name in ['status','name','birth','mother','sex','queried_at']:c.execute('ALTER TABLE lookups ADD COLUMN '+name+' TEXT')
   c.execute('INSERT INTO lookups VALUES(?,?,?,?,?,?,?)',('52998224725','ok','JOSE OUTRO TESTE','02/02/1980','MAE NOVA','M','2026-11-06T12:00:00Z'))
  ingest(self.source,self.db);row=self.item();self.assertEqual(row['mae_api'],'MAE NOVA');self.assertFalse(row['api_cache_ativo']);self.assertTrue(row['api_evidencia_historica'])
 def test_newer_not_found_is_flagged_without_erasing_success(self):
  with sqlite3.connect(self.source/'consultas.sqlite') as c:
   for name in ['status','name','birth','mother','sex','queried_at']:c.execute('ALTER TABLE lookups ADD COLUMN '+name+' TEXT')
   c.execute('INSERT INTO lookups VALUES(?,?,?,?,?,?,?)',('52998224725','nao_encontrado',None,None,None,None,'2026-11-06T12:00:00Z'))
  ingest(self.source,self.db);row=self.item();self.assertEqual(row['nome_api'],'JOSE OUTRO TESTE');self.assertTrue(row['api_consulta_contraditoria']);self.assertEqual(row['api_ultimo_status'],'nao_encontrado')
 def test_receiving_cpf_number_alone_does_not_reset_rejection(self):
  with sqlite3.connect(self.source/'recuperacao.sqlite') as c:c.execute('DELETE FROM signatures')
  ingest(self.source,self.db);row=self.item();decide(101,'rejected',row['revision'],'teste',self.db)
  with sqlite3.connect(self.source/'recuperacao.sqlite') as c:c.execute('INSERT INTO signatures VALUES(?,?)',('a'*64,'52998224725'))
  ingest(self.source,self.db);self.assertEqual(self.item()['decision'],'rejected');self.assertEqual(self.item()['revision'],row['revision']);self.assertEqual(self.item()['cpf'],'52998224725')
 def test_stale_snapshot_and_repeated_ids_do_not_replace_current_data(self):
  source=json.loads((self.source/'signatures.json').read_text());source['at']='2026-11-05T12:00:00Z';(self.source/'signatures.json').write_text(json.dumps(source))
  with self.assertRaises(ValueError):ingest(self.source,self.db)
  self.assertEqual(listing({'view':'all'},self.db)['total'],1)
  source['at']='2026-11-06T12:00:00Z';source['signatures'].append(dict(source['signatures'][0]));(self.source/'signatures.json').write_text(json.dumps(source))
  with self.assertRaises(ValueError):ingest(self.source,self.db)
 def test_concurrent_manual_decision_is_not_lost_during_ingestion(self):
  row=self.item();entered=threading.Event();release=threading.Event();finished=threading.Event();errors=[]
  from data import newest as original
  def pause(*args):entered.set();release.wait(3);return original(*args)
  def receive():
   try:ingest(self.source,self.db)
   except Exception as e:errors.append(e)
  def decide_later():
   try:decide(101,'rejected',row['revision'],'teste',self.db);finished.set()
   except Exception as e:errors.append(e)
  with patch('data.newest',pause):
   receiving=threading.Thread(target=receive);receiving.start();self.assertTrue(entered.wait(3));decision=threading.Thread(target=decide_later);decision.start();self.assertFalse(finished.wait(.1));release.set();receiving.join(4);decision.join(4)
  self.assertFalse(errors);self.assertTrue(finished.is_set());self.assertEqual(self.item()['decision'],'rejected')

 def test_migration_preserves_legacy_manual_decisions_and_history(self):
  row=self.item();decide(101,'rejected',row['revision'],'teste',self.db)
  with sqlite3.connect(self.db) as c:
   c.execute("DELETE FROM metadata WHERE key='review_revision_schema'");c.execute("UPDATE records SET revision='legacy-full-data-hash'")
   history=c.execute('SELECT * FROM decisions').fetchall()
  with connect(self.db) as c:
   current=c.execute('SELECT decision,decision_origin,revision FROM records').fetchone();self.assertEqual(tuple(current[:2]),('rejected','manual'));self.assertNotEqual(current['revision'],'legacy-full-data-hash');self.assertEqual(c.execute('SELECT * FROM decisions').fetchall()[0]['current'],history[0][4])
 def test_query_times_compare_actual_instants_in_different_timezones(self):
  from data import newest
  old={'status':'ok','name':'OLD','queried_at':'2026-11-06T12:00:00+00:00'}
  new={'status':'ok','name':'NEW','queried_at':'2026-11-06T09:01:00-03:00'}
  self.assertEqual(newest([old,new])['name'],'NEW')

 def test_equivalent_name_formatting_preserves_approved_and_rejected(self):
  for decision in ['approved','rejected']:
   with self.subTest(decision=decision):
    self.row['name']='Maria Exemplo Silva';self.write();ingest(self.source,self.db)
    before=self.item();decide(101,decision,before['revision'],'teste',self.db)
    self.row['name']='  MÁRIA  de EXEMPLO da SILVA ';self.write()
    data=json.loads((self.source/'cache.json').read_text());data['records'][0]['name']='José de Outro  Teste';data['records'][0]['queried_at']='2026-11-06T12:00:00Z';(self.source/'cache.json').write_text(json.dumps(data))
    ingest(self.source,self.db);after=self.item();self.assertEqual(after['revision'],before['revision']);self.assertEqual(after['decision'],decision)
 def test_actual_spelling_or_order_change_requires_only_affected_review(self):
  for name in ['Maria Exemplu Silva','Maria Silva Exemplo']:
   with self.subTest(name=name):
    self.row['name']='Maria Exemplo Silva';self.write();ingest(self.source,self.db)
    before=self.item();decide(101,'approved',before['revision'],'teste',self.db)
    self.row['name']=name;self.write();ingest(self.source,self.db)
    self.assertEqual(self.item()['decision'],'pending');self.assertNotEqual(self.item()['revision'],before['revision'])
 def test_v2_to_v3_migration_keeps_manual_decisions_and_history_exactly(self):
  row=self.item();decide(101,'rejected',row['revision'],'teste',self.db)
  with sqlite3.connect(self.db) as c:
   c.execute("UPDATE metadata SET value='name-cpf-v2' WHERE key='review_revision_schema'");c.execute("UPDATE records SET revision='old-raw-name-revision'")
   history=c.execute('SELECT * FROM decisions').fetchall()
  with connect(self.db) as c:
   self.assertEqual(c.execute("SELECT value FROM metadata WHERE key='review_revision_schema'").fetchone()[0],'name-cpf-v3')
   current=c.execute('SELECT decision,decision_origin,revision FROM records').fetchone();self.assertEqual(tuple(current[:2]),('rejected','manual'));self.assertNotEqual(current['revision'],'old-raw-name-revision');self.assertEqual([tuple(r) for r in c.execute('SELECT * FROM decisions')],history)

if __name__=='__main__':unittest.main()
