import argparse, importlib.util, json, tempfile, unittest
from pathlib import Path
spec=importlib.util.spec_from_file_location('simple',Path(__file__).resolve().parents[1]/'vigia_simples.py')
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
class SimpleTests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.previous=module.STATE;self.tab=module.ACTIVE_TAB;module.ACTIVE_TAB="running";module.STATE=Path(self.tmp.name)
 def tearDown(self):module.STATE=self.previous;module.ACTIVE_TAB=self.tab;self.tmp.cleanup()
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
 def test_tabs_separate_tasks_and_completed_does_not_include_live_processes(self):
  from rich.console import Console
  from io import StringIO
  module.register(self.args(register='active',title='TAREFA_ATIVA'))
  module.register(self.args(register='done',title='TAREFA_FINALIZADA',state='completed'))
  data={'at':module.now(),'activities':module.activities(),'processes':[{'pid':1,'name':'PROCESSO_VIVO','port':'3031','cwd':'/mnt/dev/peticao'}],'services':[],'vps':{'state':'desativado'}}
  for width,height in [(80,24),(120,40)]:
   for tab,present,absent in [('running','TAREFA_ATIVA','TAREFA_FINALIZADA'),('completed','TAREFA_FINALIZADA','TAREFA_ATIVA')]:
    module.ACTIVE_TAB=tab;stream=StringIO();Console(file=stream,width=width,height=height).print(module.render(data,width,height));value=stream.getvalue()
    self.assertIn(present,value);self.assertNotIn(absent,value);self.assertIn('Concluídos',value)
    if tab=='completed':self.assertNotIn('PROCESSO_VIVO',value)
 def test_task_moves_between_tabs_without_losing_history(self):
  original=module.register(self.args())
  module.register(self.args(state='completed',detail='Resultado preservado'))
  active,done=module.task_groups({'activities':module.activities()});self.assertEqual(active,[]);self.assertEqual(done[0]['detail'],'Resultado preservado');self.assertEqual(done[0]['created_at'],original['created_at'])
 def test_real_pty_handles_rapid_keys_and_quits(self):
  import os,pty,fcntl,termios,struct,subprocess,time,select,sys
  master,slave=pty.openpty();fcntl.ioctl(slave,termios.TIOCSWINSZ,struct.pack('HHHH',24,80,0,0))
  env={**os.environ,'VIGIA_SIMPLES_STATE':self.tmp.name,'TERM':'xterm-256color'}
  p=subprocess.Popen([sys.executable,str(Path(module.__file__)),'--sem-vps'],stdin=slave,stdout=slave,stderr=slave,start_new_session=True,env=env);os.close(slave)
  try:
   output=b'';deadline=time.monotonic()+5
   while time.monotonic()<deadline:
    ready,_,_=select.select([master],[],[],.1)
    if ready:
     output+=os.read(master,8192)
     if b'VIGIA SIMPLES' in output:break
   self.assertIn(b'VIGIA SIMPLES',output);os.write(master,b'2\t1jrq')
   # Drain PTY redraws while awaiting exit, as a real terminal emulator does.
   deadline=time.monotonic()+5
   while p.poll() is None and time.monotonic()<deadline:
    ready,_,_=select.select([master],[],[],.1)
    if ready:
     try:output+=os.read(master,65536)
     except OSError:break
   self.assertEqual(p.wait(timeout=1),0)
  finally:
   if p.poll() is None:
    p.terminate()
    try:p.wait(timeout=2)
    except subprocess.TimeoutExpired:p.kill();p.wait()
   os.close(master)
if __name__=='__main__':unittest.main()
