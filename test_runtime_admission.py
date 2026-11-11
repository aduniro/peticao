import unittest,tempfile,pathlib,json,hashlib,types
from unittest.mock import patch
import run as r
class Admission(unittest.TestCase):
 def fixture(self,root):
  out=root/'export';runtime=out/'runtime';runtime.mkdir(parents=True)
  routes=['api/admin/materiais','api/admin/materiais/[id]','api/admin/materiais/pedidos/[requestId]','api/admin/materiais/[id]/previa']
  files={'.next/BUILD_ID':b'fictitious','package.json':b'{}','package-lock.json':b'{}','node_modules/pg/package.json':b'{}','.next/server/app-paths-manifest.json':json.dumps({'/'+x+'/route':'app/'+x+'/route.js'for x in routes}).encode()}
  for x in routes:files['.next/server/app/'+x+'/route.js']=b'fixture compiled bytes, never imported'
  pins={}
  for name,data in files.items():p=runtime/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data);pins[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
  m={'source_commit':r.COMMIT,'release_id':'materials-preview-140ce6b-local-20261111','runtime_format':'next-start-v1','entrypoint':'node_modules/next/dist/bin/next','files':pins};path=out/'release-manifest.json';path.write_text(json.dumps(m))
  cfg={'infra_reviewed':True,'source_commit':r.COMMIT,'newRuntimeRequired':True,'runtime_manifest_path':str(path),'runtime_dir':str(runtime),'runtime_manifest_sha256':r.sha(path)}
  return out,path,runtime,m,cfg
 def test_missing_pin_blocks_main_before_marker_docker_or_socket(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);config=root/'config.json';config.write_text(json.dumps({'infra_reviewed':True,'runtime_manifest_sha256':None}))
   with patch.object(r,'CONFIG_PATH',config),patch.object(r,'verify_local_manifest',side_effect=AssertionError('marker forbidden')),patch.object(r,'DockerPG',side_effect=AssertionError('Docker forbidden')),patch.object(r.http.client,'HTTPConnection',side_effect=AssertionError('HTTP forbidden')):
    with self.assertRaisesRegex(ValueError,'pin absent'):r.main()
   self.assertEqual(sorted(p.name for p in root.iterdir()),['config.json'])
 def scenario(self,kind):
  with tempfile.TemporaryDirectory()as tmp:
   out,path,runtime,m,cfg=self.fixture(pathlib.Path(tmp))
   if kind=='old_source':m['source_commit']='f'*40
   elif kind=='missing_route':del m['files']['.next/server/app/api/admin/materiais/[id]/previa/route.js'];(runtime/'.next/server/app/api/admin/materiais/[id]/previa/route.js').unlink()
   elif kind=='route_map':
    p=runtime/'.next/server/app-paths-manifest.json';p.write_text('{}');m['files'][str(p.relative_to(runtime))]={'bytes':p.stat().st_size,'sha256':r.sha(p)}
   elif kind=='bytes':(runtime/'package.json').write_text('{"drift":true}')
   elif kind=='extra':(runtime/'extra.env').write_text('fictitious')
   elif kind=='symlink':(runtime/'link').symlink_to(runtime/'package.json')
   elif kind=='infra_false':cfg['infra_reviewed']=False
   elif kind=='foreign_root':cfg['runtime_dir']='/mnt/dev/old-f555-runtime'
   elif kind!='valid':raise AssertionError(kind)
   path.write_text(json.dumps(m));cfg['runtime_manifest_sha256']=r.sha(path)
   with patch.object(r,'APPROVED_EXPORT_ROOT',out):
    if kind=='valid':self.assertEqual(r.admit_runtime(cfg)[2],m['files'])
    else:
     with self.assertRaises(ValueError):r.admit_runtime(cfg)
 def test_new_exact_runtime_accepted(self):self.scenario('valid')
 def test_old_source_denied(self):self.scenario('old_source')
 def test_absent_preview_route_denied(self):self.scenario('missing_route')
 def test_wrong_compiled_route_map_denied(self):self.scenario('route_map')
 def test_changed_bytes_denied(self):self.scenario('bytes')
 def test_extra_member_denied(self):self.scenario('extra')
 def test_symlink_denied(self):self.scenario('symlink')
 def test_infra_false_denied(self):self.scenario('infra_false')
 def test_old_or_foreign_runtime_path_denied(self):self.scenario('foreign_root')
if __name__=='__main__':unittest.main()
