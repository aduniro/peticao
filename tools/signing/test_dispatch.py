import unittest,tempfile,os,json,io,importlib.util,urllib.error
from pathlib import Path
spec=importlib.util.spec_from_file_location("dispatch",Path(__file__).with_name("dispatch.py"));mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Response(io.BytesIO):
 status=200
class Fake:
 def __init__(self,value=b'{"ran":false,"state":"disabled"}'):self.calls=[];self.value=value
 def open(self,request,timeout):self.calls.append((request,timeout));return Response(self.value)
class Tests(unittest.TestCase):
 def setUp(self):self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name);self.key=self.root/'cron-token';self.key.write_text('QA-ONLY-NOT-A-REAL-CRON-TOKEN');self.key.chmod(0o600)
 def tearDown(self):self.tmp.cleanup()
 def test_fixed_local_empty_request_and_no_secret_in_result(self):
  fake=Fake();result=mod.dispatch(self.root,fake);self.assertTrue(result['ok']);request,timeout=fake.calls[0];self.assertEqual(request.full_url,mod.URL);self.assertEqual(request.data,b'');self.assertEqual(timeout,110);self.assertNotIn('TOKEN',json.dumps(result));self.assertEqual(request.get_header('Authorization'),'Bearer QA-ONLY-NOT-A-REAL-CRON-TOKEN')
 def test_insecure_symlink_missing_and_control_credentials_never_contact(self):
  for action in ['mode','symlink','missing','control']:
   if self.key.is_symlink():self.key.unlink()
   self.key.write_text('QA-ONLY-NOT-A-REAL-CRON-TOKEN');self.key.chmod(0o600)
   if action=='mode':self.key.chmod(0o644)
   elif action=='symlink':self.key.rename(self.root/'actual');self.key.symlink_to(self.root/'actual')
   elif action=='missing':self.key.unlink()
   else:self.key.write_text('QA-ONLY-TOKEN\nInjected: bad')
   fake=Fake();self.assertFalse(mod.dispatch(self.root,fake)['ok']);self.assertEqual(fake.calls,[])
 def test_bad_or_excessive_response_is_rejected(self):
  for value in [b'x'*2049,b'bad-json',b'{"ran":true,"state":"unknown"}']:
   self.assertFalse(mod.dispatch(self.root,Fake(value))['ok'])
 def test_no_redirect_to_another_address(self):
  self.assertIsNone(mod.NoRedirect().redirect_request(None,None,302,'',{},'https://outside.invalid/'))
if __name__=='__main__':unittest.main()
