import unittest,tempfile,pathlib,json,importlib.util,hashlib
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('profile',ROOT/'production_profile.py');profile=importlib.util.module_from_spec(spec);spec.loader.exec_module(profile)
spec=importlib.util.spec_from_file_location('protocol',ROOT/'materials_http.py');protocol=importlib.util.module_from_spec(spec);spec.loader.exec_module(protocol)
class Preparation(unittest.TestCase):
 def test_activation_closed_before_marker_or_subprocess(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);(root/'config.json').write_text('{"infra_reviewed":false}')
   with patch.object(profile,'ROOT',root),patch.object(profile,'preflight',side_effect=AssertionError('must not call')),patch.object(profile.subprocess,'Popen',side_effect=AssertionError('must not launch')):
    with self.assertRaisesRegex(ValueError,'preparation_only'):profile.execute_build()
   self.assertFalse((root/'execution.started').exists())
 def test_git_source_has_no_environment_or_runtime_state(self):
  m=json.loads((ROOT/'source-manifest.json').read_text());self.assertEqual(m['commit'],profile.COMMIT)
  for n in m['files']:
   self.assertFalse(any(p.startswith('.env')or p in {'secrets','preview-state','.cache','node_modules','.next'}for p in pathlib.PurePosixPath(n).parts))
  self.assertIn('site/src/app/api/admin/materiais/[id]/previa/route.ts',m['files'])
  self.assertNotIn('site/src/lib/materials-client.ts',m['files'])
 def test_source_stage_rejects_path_escape_before_git_read(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);(root/'source-manifest.json').write_text(json.dumps({'commit':profile.COMMIT,'files':{'../escape':{'mode':'100644'}}}))
   with patch.object(profile,'ROOT',root),patch.object(profile.subprocess,'check_output',side_effect=AssertionError('must not read Git')):
    with self.assertRaisesRegex(ValueError,'unsafe_source'):profile.stage_exact_source(root/'stage')
 def test_cache_changed_bytes_fail_closed(self):
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);deps=root/'deps';deps.mkdir();(deps/'a').write_bytes(b'changed')
   (root/'dependency-cache-manifest.json').write_text(json.dumps({'root':str(deps),'entries':{'a':{'bytes':3,'sha256':hashlib.sha256(b'old').hexdigest()}}}))
   with patch.object(profile,'ROOT',root),patch.object(profile,'DEPS',deps):
    with self.assertRaisesRegex(ValueError,'cache_bytes_changed'):profile.verify_dependency_cache()
 def test_build_guard_only_namespace_delta_from_accepted_recipe(self):
  old=pathlib.Path('/mnt/dev/.peticao-r0002-production-profile-20261111/production-build-guard.mjs')
  self.assertEqual(old.read_text().replace('/mnt/dev/.peticao-r0002-production-profile-20261111',str(ROOT)),(ROOT/'production-build-guard.mjs').read_text())
 def example(self):
  import base64
  content=protocol.CONTENT1;v={'id':'11111111-1111-4111-8111-111111111111','revision':1,'content':content,'sha256':protocol.content_digest(content)};head={'id':'22222222-2222-4222-8222-222222222222','revision':3}
  body=('<style>body{color:black}</style>'+''.join(__import__('html').escape(content[k])for k in ['title','body','callToAction','footer'])).encode();style=base64.b64encode(hashlib.sha256(b'body{color:black}').digest()).decode()
  h={'content-type':'text/html; charset=utf-8','cache-control':'private, no-store','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','referrer-policy':'no-referrer','x-material-version-id':v['id'],'x-material-version-revision':'1','x-material-content-sha256':v['sha256'],'x-material-observed-head-version-id':head['id'],'x-material-observed-head-revision':'3','x-material-preview-scope':'exact-historical-version','content-security-policy':f"default-src 'none'; script-src 'none'; style-src 'sha256-{style}'; img-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'"}
  return h,body,v,head
 def test_requested_old_version_with_new_archived_head(self):
  h,b,v,head=self.example();self.assertEqual(protocol.preview_assert(200,h,b,v,head)['revision'],1)
 def test_preview_cannot_substitute_head(self):
  h,b,v,head=self.example();h['x-material-version-id']=head['id']
  with self.assertRaisesRegex(ValueError,'metadata'):protocol.preview_assert(200,h,b,v,head)
 def test_preview_wrong_csp_fails(self):
  h,b,v,head=self.example();h['content-security-policy']="default-src *"
  with self.assertRaisesRegex(ValueError,'CSP'):protocol.preview_assert(200,h,b,v,head)
 def test_preview_html_substitution_fails(self):
  h,b,v,head=self.example();b=b.replace(v['content']['title'].encode(),b'wrong text')
  with self.assertRaisesRegex(ValueError,'historical text'):protocol.preview_assert(200,h,b,v,head)
 def test_preview_content_digest_drift_fails(self):
  h,b,v,head=self.example();v['content']={**v['content'],'title':'Outro'}
  with self.assertRaisesRegex(ValueError,'digest'):protocol.preview_assert(200,h,b,v,head)
if __name__=='__main__':unittest.main()
