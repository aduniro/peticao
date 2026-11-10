#!/usr/bin/python3
"""Code-only provenance; no environment, DB state, lease or generated test output."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parent
FILES=['.gitignore','native_pg.py','functional_smoke.py','functional-guard.mjs','fixture.cjs','test_native_pg.py','test_runtime_preflight.py','test_guard.py','generate_manifest.py','build_bundle.py','README.md','profile.proposed.json','remote-config.example.json','schema-source-manifest.json','release-manifest.json']
FILES+=['schema-sources/'+p.name for p in sorted((ROOT/'schema-sources').glob('*.ts'))]
def digest(p):return hashlib.sha256(p.read_bytes()).hexdigest()
def http_block(text):return text[text.index("  check('unauthenticated history'"):text.index("  result['exit']=0")]
def main():
 old=ROOT.parent/'remote-bundle-r3/functional_smoke.py';block=http_block((ROOT/'functional_smoke.py').read_text())
 if http_block(old.read_text())!=block:raise ValueError('19 HTTP checks changed versus R3')
 manifest={'schema_version':1,'classification':'R4_NATIVE_HARNESS_PREPARED_NOT_HTTP_QUALIFIED','operationalReady':False,'runtimeSourceCommit':'0a5f734da4f9b8a35a10a20eaa9fb4fd5adb0e4f','plannedHttpChecks':19,'executedPopulatedHttpChecks':0,'httpChecksUnchangedFromR3Sha256':hashlib.sha256(block.encode()).hexdigest(),'files':{name:{'sha256':digest(ROOT/name),'bytes':(ROOT/name).stat().st_size} for name in FILES}}
 (ROOT/'code-manifest.json').write_text(json.dumps(manifest,indent=2,sort_keys=True)+'\n');print('codeManifestSha256',digest(ROOT/'code-manifest.json'))
if __name__=='__main__':main()
