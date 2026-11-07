import argparse, importlib.util, json, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('simple',Path(__file__).resolve().parents[1]/'vigia_simples.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class SimpleTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.previous=module.STATE;module.STATE=Path(self.tmp.name)
 def tearDown(self):module.STATE=self.previous;self.tmp.cleanup()
 def args(self,**kw):return argparse.Namespace(**dict({'register':'fixture','title':'Teste','state':'running','stage':'Testando','environment':'local','scope':'QA','eta':None,'detail':None,'done':None,'total':None},**kw))
 def test_atomic_state_preserves_creation_and_has_private_mode(self):
  one=module.register(self.args());two=module.register(self.args(state='completed'))
  self.assertEqual(one['created_at'],two['created_at']);self.assertEqual(module.activities()[0]['state'],'completed')
  self.assertEqual((module.STATE/'activities/fixture.json').stat().st_mode&0o777,0o600)
 def test_counts_require_fixed_total(self):
  with self.assertRaises(ValueError):module.register(self.args(done=2))
  row=module.register(self.args(done=2,total=4));self.assertEqual(row['done']/row['total'],.5)
 def test_invalid_ids_and_control_sequences(self):
  with self.assertRaises(ValueError):module.register(self.args(register='../escape'))
  self.assertNotIn('\x1b',module.clean('\x1b]52;c;payload\x07visible'))
  self.assertNotIn('529.982.247-25',module.clean('CPF 529.982.247-25'))
  self.assertNotIn('MY_PRIVATE_KEY',module.clean('api_key=MY_PRIVATE_KEY'))
 def test_partial_or_malformed_files_do_not_break_dashboard(self):
  (module.STATE/'activities').mkdir();(module.STATE/'activities/bad.json').write_text('{')
  self.assertEqual(module.activities(),[])
 def test_compact_and_detailed_render_without_errors(self):
  from rich.console import Console
  from io import StringIO
  module.register(self.args());data={'at':module.now(),'activities':module.activities(),'processes':[{'pid':1,'name':'QA','port':'3031','cwd':'/mnt/dev/peticao'}],'services':[],'vps':{'state':'desativado'}}
  for width,height in [(80,24),(120,40)]:
   stream=StringIO();Console(file=stream,width=width,height=height).print(module.render(data,width,height));self.assertIn('VIGIA SIMPLES',stream.getvalue())
if __name__=='__main__':unittest.main()
