"""Pure export-admission regressions: synthetic tiny files; no existing runtime/build is read."""
import unittest,tempfile,pathlib,json,hashlib,types,sys
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parent
COMMIT='140ce6b98af23045849335693a82b426fdc9c826'
class ReachedMaterialization(RuntimeError):pass

def module(filename):
 value=types.ModuleType('export_'+filename.stem);value.__file__=str(filename);exec(compile(filename.read_text(),str(filename),'exec'),value.__dict__);return value

class ExportIdentity(unittest.TestCase):
 def exercise(self,kind,baseline=False):
  exporter=module(ROOT/'fixtures/exporter-09baddad.py'if baseline else ROOT/'portable_runtime.py')
  with tempfile.TemporaryDirectory()as tmp:
   root=pathlib.Path(tmp);build=root/'runs/copied';(build/'clone/site').mkdir(parents=True)
   data=b'fictitious source only';digest=hashlib.sha256(data).hexdigest();(build/'clone/site/one.ts').write_bytes(data)
   (root/'config.json').write_text('{"infra_reviewed":true}')
   frozen={'commit':COMMIT,'files':{'site/one.ts':{'sha256':digest,'bytes':len(data)}}}
   (root/'source-manifest.json').write_text(json.dumps(frozen))
   flags=['sourceStable','cloneSourceStable','sourceClean','sourceHeadStable','profileStable','targetEvidenceStable','guardInstalled','assetsStable','processGroupDrained','noPreview','dependencyCacheStable']
   result={**dict.fromkeys(flags,True),'exit':0,'networkDenials':0,'remainingBuildProcesses':[],'fakeSecretsEmbedded':[],'postgresStarted':False,'listenerStarted':False,'sourceCommit':COMMIT}
   target=root/'target.json';target.write_text('{}');profile={'sourceCommit':COMMIT,'target':{'targetEvidence':str(target),'targetEvidenceSha256':hashlib.sha256(target.read_bytes()).hexdigest()}}
   source={'site/one.ts':digest}
   if kind=='result_old':result['sourceCommit']='f'*40
   elif kind=='profile_old':profile['sourceCommit']='f'*40
   elif kind=='both_old':result['sourceCommit']=profile['sourceCommit']='f'*40
   elif kind=='omitted':source={}
   elif kind=='extra':source['site/extra.ts']=digest;(build/'clone/site/extra.ts').write_bytes(data)
   elif kind=='wrong_hash':source['site/one.ts']=hashlib.sha256(b'new fake source').hexdigest();(build/'clone/site/one.ts').write_bytes(b'new fake source')
   elif kind=='wrong_bytes':(build/'clone/site/one.ts').write_bytes(b'changed')
   elif kind!='valid':raise AssertionError(kind)
   for name,obj in [('result.json',result),('profile.json',profile),('source-manifest.json',source),('runtime-assets-manifest.json',{})]:(build/name).write_text(json.dumps(obj))
   exporter.ROOT=root;exporter.package_inventory=lambda *a:(_ for _ in ()).throw(ReachedMaterialization('sentinel; no export performed'))
   fake=types.SimpleNamespace(COMMIT=COMMIT,verify_profile_pins=lambda:True,verify_dependency_cache=lambda:True)
   with patch.dict(sys.modules,{'production_profile':fake}),patch('shutil.disk_usage',return_value=types.SimpleNamespace(free=8*1024**3)):
    if baseline and kind!='wrong_bytes' or kind=='valid':
     with self.assertRaises(ReachedMaterialization):exporter.export(build,root/'export')
    else:
     with self.assertRaisesRegex(ValueError,'export_source_|export_frozen_'):exporter.export(build,root/'export')
   self.assertFalse((root/'export').exists())
 def test_old_result(self):self.exercise('result_old')
 def test_old_profile(self):self.exercise('profile_old')
 def test_old_copied_build(self):self.exercise('both_old')
 def test_omitted_source(self):self.exercise('omitted')
 def test_extra_source(self):self.exercise('extra')
 def test_wrong_source_hash(self):self.exercise('wrong_hash')
 def test_changed_clone_bytes(self):self.exercise('wrong_bytes')
 def test_exact_current_source_admitted_to_next_gate(self):self.exercise('valid')
 def test_baseline_old_result_reaches_materialization(self):self.exercise('result_old',True)
 def test_baseline_old_profile_reaches_materialization(self):self.exercise('profile_old',True)
 def test_baseline_old_copied_build_reaches_materialization(self):self.exercise('both_old',True)
 def test_baseline_omitted_source_reaches_materialization(self):self.exercise('omitted',True)
 def test_baseline_extra_source_reaches_materialization(self):self.exercise('extra',True)
 def test_baseline_changed_source_hash_reaches_materialization(self):self.exercise('wrong_hash',True)
if __name__=='__main__':unittest.main()
