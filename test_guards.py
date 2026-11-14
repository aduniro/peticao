import importlib.util,unittest
from pathlib import Path
from unittest.mock import patch
s=importlib.util.spec_from_file_location('neon_operator',Path(__file__).parent/'operator.py');op=importlib.util.module_from_spec(s);s.loader.exec_module(op)
def value():return {'project':op.PROJECT,'database':'infra','role':'infra_owner','host':'ep-fictional.us-east-2.aws.neon.tech','port':5432,'password':'fictitious:pass\\word'}
class Guards(unittest.TestCase):
 def test_exact_scope(self):self.assertEqual(op.validate(value())['database'],'infra')
 def test_wrong_database_role_project_port_denied(self):
  for key,val in [('database','peticao-stage'),('role','app_owner'),('project','other'),('port',22)]:
   v=value();v[key]=val
   with self.assertRaises(ValueError):op.validate(v)
 def test_unrelated_host_refused(self):
  for h in ['localhost','neon.tech.attacker.invalid','ep;echo.neon.tech','ep.neon.tech/other']:
   v=value();v['host']=h
   with self.assertRaises(ValueError):op.validate(v)
 def test_newline_password_refused(self):
  v=value();v['password']='x\ny'
  with self.assertRaises(ValueError):op.validate(v)
 def test_pgpass_escaping(self):self.assertEqual(op.escape('x:y\\z'),r'x\:y\\z')
 def test_valid_readonly_tls_output(self):self.assertEqual(op.parse_sql('BEGIN\n1|infra|infra_owner|on\nt|TLSv1.3|TLS_AES_256_GCM_SHA384\nROLLBACK\n')['role'],'infra_owner')
 def test_wrong_identity_or_writable_refused(self):
  for first in ['1|app|infra_owner|on','1|infra|other|on','1|infra|infra_owner|off']:
   with self.assertRaises(ValueError):op.parse_sql(first+'\nt|TLSv1.3|cipher\n')
 def test_no_tls_refused(self):
  with self.assertRaises(ValueError):op.parse_sql('1|infra|infra_owner|on\nf||\n')
 def test_redirect_refused(self):
  with self.assertRaises(PermissionError):op.NoRedirect().redirect_request(None,None,None,None,None,None)
 def test_wrong_host_stops_before_credentials(self):
  with patch.object(op.os,'getuid',return_value=1000),patch.object(op.pwd,'getpwuid') as p,patch.object(op.socket,'gethostname',return_value='peticao-sp'),patch.object(op,'api_check') as api:
   p.return_value.pw_name='civo'
   with self.assertRaises(PermissionError):op.main({})
   api.assert_not_called()
if __name__=='__main__':unittest.main()
