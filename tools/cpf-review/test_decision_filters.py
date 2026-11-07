import json,unittest
from unittest.mock import patch
from test_data import ReviewFixture
from data import listing,connect
from name_review import schema,get_names,decide_name,bulk_preview

class DecisionFilterTests(ReviewFixture,unittest.TestCase):
 def setUp(self):
  super().setUp()
  with connect(self.db) as db:
   schema(db);base=dict(db.execute('SELECT * FROM records WHERE id=101').fetchone())
   for sid in range(102,163):
    row=dict(base);row['id']=sid;row['classification']='ordem_diferente' if sid%2 else 'divergencia_forte';row['status']='confirmed' if sid%2 else 'pending';row['decision']=['pending','approved','rejected'][sid%3]
    data=json.loads(row['data']);data.update(id=sid,classification=row['classification'],status=row['status']);row['data']=json.dumps(data)
    db.execute('INSERT INTO records('+','.join(row)+') VALUES('+','.join('?' for _ in row)+')',tuple(row.values()))
 def stub(self,record):return dict(entered_resolved=record['name'],api_resolved=record.get('nome_api'),proposed=record['name'],special=False,alternatives=[],reasons=[],dictionary_version='fixture-v1')
 def name(self,sid,decision):
  with patch('name_dictionary.suggest',self.stub):
   n=get_names(sid,self.db);decide_name(sid,dict(n,decision=decision,choice='entered'),'fixture',self.db)
 def test_independent_combinations_across_all_categories_and_signature_status(self):
  self.name(103,'approved');self.name(104,'rejected');self.name(105,'approved')
  self.assertEqual({r['id'] for r in listing({'view':'approved','name_decision':'approved'},self.db)['rows']},{103})
  self.assertEqual({r['id'] for r in listing({'view':'not_approved','name_decision':'approved'},self.db)['rows']},{105})
  a=listing({'view':'all','name_decision':'approved'},self.db);self.assertEqual(a['total'],2)
  for group in ['ordem_diferente','divergencia_forte']:
   selected=listing({'view':'all','name_decision':'not_approved','group':group},self.db)
   self.assertTrue(selected['rows']);self.assertTrue(all(r['id'] not in {103,105} for r in selected['rows']))
  self.assertEqual(listing({'view':'approved','name_decision':'approved','status':'pending'},self.db)['total'],0)
 def test_name_filter_applies_before_total_and_pagination(self):
  self.name(103,'approved');self.name(160,'approved')
  a=listing({'view':'all','name_decision':'pending','page':2},self.db);self.assertEqual(a['total'],60);self.assertEqual(len(a['rows']),10);self.assertTrue(all(r['id'] not in {103,160} for r in a['rows']))
 def test_stale_approval_is_pending_and_read_never_changes_saved_decisions(self):
  self.name(103,'approved')
  with connect(self.db) as db:
   db.execute("UPDATE records SET revision='new-revision' WHERE id=103");before=[tuple(r) for r in db.execute('SELECT * FROM name_decisions')];history=[tuple(r) for r in db.execute('SELECT * FROM name_history')]
  result=listing({'view':'all','name_decision':'pending'},self.db)
  # Record 103 is included among pending; inspect all matching rows without page-size assumptions.
  all_ids={r['id'] for page in [1,2] for r in listing({'view':'all','name_decision':'pending','page':page},self.db)['rows']};self.assertIn(103,all_ids)
  self.assertEqual(listing({'view':'all','name_decision':'approved'},self.db)['total'],0)
  with connect(self.db) as db:self.assertEqual(before,[tuple(r) for r in db.execute('SELECT * FROM name_decisions')]);self.assertEqual(history,[tuple(r) for r in db.execute('SELECT * FROM name_history')])
 def test_bulk_preview_obeys_both_filters_and_invalid_values_are_rejected(self):
  self.name(103,'approved')
  with patch('name_dictionary.suggest',self.stub):
   p=bulk_preview({'kind':'name','decision':'approved','filters':{'view':'approved','group':'ordem_diferente','name_decision':'pending'}},self.db)
   with connect(self.db) as db:items=json.loads(db.execute('SELECT payload FROM review_batches WHERE id=?',(p['token'],)).fetchone()[0])['items']
   self.assertTrue(items);self.assertNotIn(103,{r['id'] for r in items});self.assertTrue(all(r['id']%2==1 and r['id']%3==1 for r in items))
  with self.assertRaises(ValueError):listing({'view':'all','name_decision':"approved' OR 1=1 --"},self.db)
 def test_private_cache_replays_only_derived_labels_and_invalidates_relevant_words(self):
  from decision_filter_cache import DecisionFilterCache,DependencyIndex
  with connect(self.db) as db:
   cache=DecisionFilterCache(db,self.db,self.root);self.assertEqual(cache.get('technical-key',lambda:'approved'),'approved');cache.flush()
   second=DecisionFilterCache(db,self.db,self.root);self.assertEqual(second.get('technical-key',lambda: self.fail('Recomputed cached label')),'approved')
  data={'preferred':{},'probable_accent_errors':{}};index={'jose':[{'form':'José','source':'editorial','count':1}]}
  one=DependencyIndex((data,index,'v1')).record({'name':'Jose Silva'});index['other']=[{'form':'Other','source':'local-observed'}];index['jose'][0]['count']=99
  self.assertEqual(one,DependencyIndex((data,index,'v2')).record({'name':'Jose Silva'}))
  index['jose'].append({'form':'Jose','source':'editorial'});self.assertNotEqual(one,DependencyIndex((data,index,'v3')).record({'name':'Jose Silva'}))
