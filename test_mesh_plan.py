import configparser,copy,json,subprocess,tempfile,unittest
from pathlib import Path
import mesh_plan as m
ROOT=Path(__file__).resolve().parent
class Plan(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.nodes=m.nodes();cls.azure=next(n for n in cls.nodes if n['name']=='azure');cls.work=ROOT.parent/'test-work';cls.work.mkdir(exist_ok=True)
 def test_matrix_504_with_144_azure_edges(self):
  rows=m.matrix(self.nodes);self.assertEqual(len(rows),504);self.assertEqual(sum(r['source_node']=='azure' or r['target_node']=='azure' for r in rows),144);self.assertFalse(any(r['source_node']==r['target_node'] for r in rows))
 def proofs(self):
  return [{**r,'fresh_connection':True,'exit':0,'hostname':r['expected_hostname'],'user':r['target_user'],'uid':0 if r['target_role']=='root' else 1000,'origin_hostname':r['expected_source_hostname'],'origin_user':r['source_user'],'origin_uid':0 if r['source_role']=='root' else 1000,'hostkey_verified':True,'strict_hostkey_checking':True,'batch_id':'fictitious-one-batch'} for r in m.matrix(self.nodes)]
 def test_complete_synthetic_proofs_are_counted_not_gui(self):self.assertEqual(m.qualify(self.proofs(),m.matrix(self.nodes)),{'full_mesh_qualified':True,'connections':504,'gui_tested':False})
 def test_partial_and_old_batches_rejected(self):
  p=self.proofs()
  with self.assertRaises(ValueError):m.qualify(p[:-1],m.matrix(self.nodes))
  p[-1]['batch_id']='old'
  with self.assertRaises(ValueError):m.qualify(p,m.matrix(self.nodes))
 def test_wrong_source_and_hostpin_rejected(self):
  for key,val in [('origin_user','foreign'),('uid',None),('hostkey_verified',False),('fresh_connection',False)]:
   p=self.proofs();p[0][key]=val
   with self.assertRaises(ValueError):m.qualify(p,m.matrix(self.nodes))
 def test_public_azure_or_wildcard_port_denied(self):
  for k,v in [('ipv4','20.85.215.204'),('ipv6','::'),('port',22)]:
   nodes=copy.deepcopy(self.nodes);nodes[-1][k]=v
   with self.assertRaises(ValueError):m.validate_nodes(nodes)
 def test_cloudinit_and_public22_not_configured(self):
  s=m.azure_sshd(self.azure);self.assertIn('Port 2224\n',s);self.assertNotIn('Port 22\n',s);self.assertNotIn('0.0.0.0',s);self.assertNotIn('ListenAddress ::',s);self.assertIn('AuthorizedKeysFile .ssh/authorized_keys_peticao_tailnet_v2',s);self.assertIn('PermitRootLogin prohibit-password',s);self.assertIn('PasswordAuthentication no',s)
 def test_azure_inbound_from_only_six_tailnet_nodes(self):
  s=m.inbound_azure(self.nodes);self.assertEqual(len(s.splitlines()),12)
  for n in self.nodes[:-1]:self.assertIn('from="'+n['ipv4']+','+n['ipv6']+'"',s)
  self.assertNotIn('20.85.215.204',s)
 def test_missing_azure_keys_never_materializes_rollout(self):
  a=m.artifacts(self.nodes);self.assertNotIn('pending-authorization/azure-additions.PUBLIC',a);self.assertFalse(json.loads(a['STATUS.json'])['rollout_authorized'])
  with self.assertRaises(ValueError):m.existing_node_additions(self.nodes,{})
 def test_existing_owner_client_keys_not_reused_as_azure(self):
  with self.assertRaises(ValueError):m.existing_node_additions(self.nodes,{'root':self.nodes[0]['accounts'][0]['client_public'],'builder':self.nodes[1]['accounts'][0]['client_public']})
 def test_remmina_6_profiles_ssh_identity_no_password(self):
  profiles=m.remmina_profiles(self.azure);self.assertEqual(len(profiles),6)
  for name,raw in profiles.items():
   c=configparser.ConfigParser(interpolation=None);c.read_string(raw);r=c['remmina'];self.assertEqual(r['protocol'],'SSH');self.assertEqual(r['ssh_auth'],'1');self.assertEqual(r['ssh_stricthostkeycheck'],'1');self.assertNotIn('password',r);self.assertIn(r['username'],['root','builder']);self.assertEqual(r['ssh_privatekey'],'/home/barre/.ssh/id_ed25519_peticao_tailnet_v2')
  self.assertIn('server=['+self.azure['ipv6']+']:2224',profiles['remmina/peticao-azure-root-ssh-ipv6.remmina'])
 def test_openssh_parses_ipv6_alias_and_pinned_literal(self):
  with tempfile.TemporaryDirectory(dir=self.work) as d:
   p=Path(d)/'config';p.write_text(m.ssh_config([self.azure],'/home/barre/.ssh/id_ed25519_peticao_tailnet_v2'))
   r=subprocess.run(['/usr/bin/ssh','-F',str(p),'-G','cluster-azure-root-ipv6'],capture_output=True,text=True,check=True)
   self.assertIn('hostname '+self.azure['ipv6'],r.stdout);self.assertIn('port 2224',r.stdout);self.assertIn('hostkeyalias ['+self.azure['dns']+']:2224',r.stdout);self.assertIn('controlmaster false',r.stdout)
 def test_known_host_lookup_port_alias_real_client(self):
  with tempfile.TemporaryDirectory(dir=self.work) as d:
   p=Path(d)/'known';p.write_text(m.known_hosts(self.nodes))
   for host in [self.azure['ipv4'],self.azure['ipv6'],self.azure['dns']]:
    r=subprocess.run(['/usr/bin/ssh-keygen','-F','['+host+']:2224','-f',str(p)],capture_output=True,text=True);self.assertEqual(r.returncode,0)
 def test_no_arbitrary_install_output(self):
  with self.assertRaises(ValueError):m.render(Path('/etc/ssh/DO-NOT-CREATE'))
 def test_generator_does_not_publish_or_start_vm(self):
  a=m.artifacts(self.nodes);r=json.loads(a['STATUS.json']);self.assertEqual(r['actual_ssh_connections_tested'],0);self.assertFalse(r['vm_started']);self.assertFalse(r['keys_generated']);self.assertFalse(r['applied']);self.assertFalse(r['gui_tested'])
if __name__=='__main__':unittest.main()
