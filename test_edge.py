import unittest,tempfile,os,json,signal,copy,contextlib,stat,urllib.parse
from pathlib import Path
from unittest import mock
import package_http as h,local_controller as c
ROOT=Path(__file__).resolve().parent
class SpoolTests(unittest.TestCase):
 def root(self):return tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')
 def test_owned_mode_roundtrip(self):
  with self.root() as t:
   r=Path(t);p=r/'mail-outbox';p.mkdir(mode=0o700);f=p/'a.json';f.write_text('{}');f.chmod(0o600);s=c.CancellationState();proof={}
   with h.readonly_spool(r,s,proof):self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o500)
   self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o700);self.assertTrue(proof['sameFilesAndHashes']);self.assertEqual(f.read_text(),'{}')
 def test_post_exception_restores(self):
  with self.root() as t:
   r=Path(t);p=r/'mail-outbox';p.mkdir(mode=0o700);proof={}
   with self.assertRaisesRegex(ValueError,'HTTP failure'):
    with h.readonly_spool(r,c.CancellationState(),proof):raise ValueError('HTTP failure')
   self.assertTrue(proof['restored']);self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o700)
 def test_repeated_term_during_restore_counted(self):
  with self.root() as t:
   r=Path(t);(r/'mail-outbox').mkdir(mode=0o700);s=c.CancellationState();proof={};original=os.fchmod
   def chmod(fd,mode):
    if mode==0o700:s.handle(signal.SIGTERM,None);s.handle(signal.SIGINT,None)
    original(fd,mode)
   with mock.patch.object(os,'fchmod',side_effect=chmod):
    with h.readonly_spool(r,s,proof):pass
   self.assertEqual(s.signals,2);self.assertFalse(s.cleaning);self.assertTrue(proof['restored'])
 def test_symlink_refused_no_target_change(self):
  with self.root() as t:
   r=Path(t);target=r/'target';target.mkdir(mode=0o700);(r/'mail-outbox').symlink_to(target)
   with self.assertRaises(OSError):
    with h.readonly_spool(r,c.CancellationState(),{}):pass
   self.assertEqual(stat.S_IMODE(target.stat().st_mode),0o700)
 def test_changed_inode_refused(self):
  with self.root() as t:
   r=Path(t);p=r/'mail-outbox';p.mkdir(mode=0o700);fd=os.open(p,os.O_RDONLY|os.O_DIRECTORY);a=os.fstat(fd)
   try:
    with self.assertRaisesRegex(RuntimeError,'same owned spool inode'):h.verify_spool_identity(p,fd,(a.st_dev,a.st_ino+1,a.st_uid),0o700)
   finally:os.close(fd)
 def test_restore_even_validation_fails_after_chmod(self):
  with self.root() as t:
   r=Path(t);p=r/'mail-outbox';p.mkdir(mode=0o700);original=h.verify_spool_identity;calls=0
   def verify(*a):
    nonlocal calls;calls+=1
    if calls==2:raise ValueError('injected validation failure')
    return original(*a)
   with mock.patch.object(h,'verify_spool_identity',side_effect=verify):
    with self.assertRaisesRegex(ValueError,'injected'):
     with h.readonly_spool(r,c.CancellationState(),{}):pass
   self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o700)

class FakeProtocol:
 def __init__(self,run,defect=None):
  self.run=run;self.defect=defect;self.calls=[];self.intents={};self.n=0;self.fault={};self.proofs={'batches':'a'*64,**{x:'b'*64 for x in ['batch_document_versions','batch_packages','petition_base_artifacts','petition_base_validations','petition_base_selections']}}
  self.state={'batches':[{'id':i,'status':'prepared','approved_at':None,'sent_at':None,'approval_code_hash':None,'approval_code_expires_at':None,'approval_attempts':0}for i in [1,2,3]],'messages':[],'attempts':[],'sends':[],'counts':{'mail_messages':0,'mail_message_attempts':0,'batch_sends':0,'mail_outbox':0},'documentByteFingerprints':self.proofs}
 def fixture(self,action):
  if action=='snapshot':return copy.deepcopy(self.state)
  if action=='stepup-fixture':return {'seededStepup':True}
  if action=='expiryseed':self.state['batches'][0]['approval_code_expires_at']='2000-01-01T00:00:00Z';return {'expirySeeded':True,'realTimeWait':False,'batchId':1}
  raise ValueError(action)
 @contextlib.contextmanager
 def fault_scope(self,run,cancellation,proof):
  yield
  proof.update(applied=True,restored=True,sameFilesAndHashes=True)
 def redirect(self,msg):return b'',{'location':'http://127.0.0.1:31391/admin?'+urllib.parse.urlencode({'msg':msg})}
 def check(self,label,method,path,expect,body=None,cookie=None):
  self.calls.append((label,method,path))
  if path=='/api/admin/login':return b'',{'set-cookie':'adm=FICTITIOUS_COOKIE; Secure; HttpOnly; SameSite=strict'}
  n=int(path.split('/')[4]);row=self.state['batches'][n-1];kind=path.rsplit('/',1)[-1];form=urllib.parse.parse_qs(body or '')
  if kind=='codigo':
   if row['approved_at']:return self.redirect('Lote não está pronto para aprovação.')
   if n in self.intents:
    if self.defect=='renew':row['approval_attempts']=0;row['approval_code_expires_at']='2099-01-01T00:00:00Z'
    return self.redirect('Solicite um novo código.')
   self.intents[n]=form;row.update(approval_code_hash='QA_HASH_'+str(n),approval_code_expires_at='2099-01-01T00:00:00Z');self.n+=1
   p=self.run/'mail-outbox'/('qa'+str(n)+'.json');p.write_text(json.dumps({'to':'qa-approver@example.test','subject':'QA: 123456'}));p.chmod(0o600)
   self.state['messages'].append({'kind':'aprovacao','status':'accepted','id':n});self.state['attempts'].append({'kind':'aprovacao','state':'accepted','provider':'dev'});self.state['counts']['mail_messages']+=1;self.state['counts']['mail_message_attempts']+=1
   return self.redirect('Código enviado ao aprovador.')
  if kind=='aprovar':
   if row['approved_at']:return self.redirect('Lote não está disponível para envio.')
   if n==1:return self.redirect('Solicite um novo código.')
   if row['approval_attempts']>=5:return self.redirect('Muitas tentativas. Solicite um novo código.')
   if form['code'][0]!='123456':row['approval_attempts']+=1;return self.redirect('Código incorreto.')
   row.update(approved_at='QA_APPROVED',status='failed',approval_code_hash=None);self.state['sends'].append({'batch_id':3,'ok':False});self.state['messages'].append({'kind':'lote','status':'indeterminate','id':4});self.state['attempts'].append({'kind':'lote','state':'indeterminate','provider':'dev'});self.state['counts']['mail_messages']+=1;self.state['counts']['mail_message_attempts']+=1;self.state['counts']['batch_sends']+=1
   return self.redirect('Enviado a 0 destinatário(s); 1 falha(s). Resultado do envio a conferir. Verifique o histórico antes de tentar outra ação.')
  if method=='GET':return json.dumps({'ok':True,'proof':'f'*64,'recipients':[{'state':'indeterminate'}]}).encode(),{}
  return json.dumps({'ok':True,'updated':0,'complete':self.defect=='false_accept'}).encode(),{}
class EdgeTests(unittest.TestCase):
 def run_fake(self,defect=None):
  with tempfile.TemporaryDirectory(dir=ROOT/'mock-proof')as t:
   r=Path(t);(r/'mail-outbox').mkdir(mode=0o700);f=FakeProtocol(r,defect)
   seed={'packages':[{'batchId':n,'documentVersion':'a'*64,'packageId':str(n),'packageDigest':'b'*64}for n in [1,2,3]]}
   with mock.patch.object(h,'readonly_spool',f.fault_scope):result=h.exercise(r,None,f.check,f.fixture,seed,c.CancellationState())
   self.assertEqual(len(f.calls),20);self.assertTrue(result['complete']);self.assertEqual(len(result['assertions']),5);self.assertEqual(result['fiveWrongHttpAttempts'],5)
   return result
 def test_full_fixed_scenarios_pure_model(self):self.run_fake()
 def test_renewal_regression_detected(self):
  with self.assertRaises(RuntimeError):self.run_fake('renew')
 def test_false_acceptance_regression_detected(self):
  with self.assertRaises(RuntimeError):self.run_fake('false_accept')
if __name__=='__main__':unittest.main()
