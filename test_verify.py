import unittest
from unittest.mock import patch
import verify

def output(server='f||',client='SSL connection (protocol: TLSv1.3, cipher: TLS_AES_256_GCM_SHA384, compression: off)'):
 return client+'\nBEGIN\n1|infra|infra_owner|on\n'+server+'\nROLLBACK\n'
class Verify(unittest.TestCase):
 def test_false_backend_does_not_replace_positive_client_tls(self):
  r=verify.parse(output());self.assertEqual(r['backend_pg_stat_ssl'],'f||');self.assertEqual(r['client_tls']['protocol'],'TLSv1.3')
 def test_backend_true_cannot_replace_missing_client_tls(self):
  with self.assertRaises(ValueError):verify.parse(output('t|TLSv1.3|cipher',''))
 def test_client_tls12_supported(self):self.assertEqual(verify.parse(output(client='SSL connection (protocol: TLSv1.2, cipher: ECDHE-RSA-AES256-GCM-SHA384, compression: off)'))['client_tls']['protocol'],'TLSv1.2')
 def test_plaintext_marker_refused(self):
  with self.assertRaises(ValueError):verify.parse(output(client='No SSL connection'))
 def test_wrong_identity_refused(self):
  with self.assertRaises(ValueError):verify.parse(output().replace('infra_owner','app_owner'))
 def test_writable_refused(self):
  with self.assertRaises(ValueError):verify.parse(output().replace('|on','|off'))
 def test_transaction_status_required(self):
  with self.assertRaises(ValueError):verify.parse(output().replace('ROLLBACK',''))
 def test_duplicate_proof_refused(self):
  with self.assertRaises(ValueError):verify.parse(output()+'1|infra|infra_owner|on\n')
 def test_old_tls_refused(self):
  with self.assertRaises(ValueError):verify.parse(output().replace('TLSv1.3','TLSv1.1'))
 def test_backend_observation_required(self):
  with self.assertRaises(ValueError):verify.parse(output().replace('f||',''))
 def test_scope_binding(self):
  b={'project':verify.PROJECT,'database':'infra','role':'infra_owner','port':5432,'host':'ep-fictional.neon.tech'};self.assertEqual(verify.binding(b)['database'],'infra');b['database']='app'
  with self.assertRaises(ValueError):verify.binding(b)
 def test_wrong_host_stops_before_credentials(self):
  with patch.object(verify.os,'getuid',return_value=1000),patch.object(verify.pwd,'getpwuid') as p,patch.object(verify.socket,'gethostname',return_value='peticao-sp'),patch.object(verify,'private') as check:
   p.return_value.pw_name='civo'
   with self.assertRaises(PermissionError):verify.main({})
   check.assert_not_called()
if __name__=='__main__':unittest.main()
