"""Dummy Node builtins only. No app/tsx import, PG, SSH, sockets or child tools."""
from pathlib import Path
import hashlib,json,os,subprocess,tempfile,unittest
ROOT=Path(__file__).parent
NODE=Path('/home/barre/.cache/peticao-qa-node20-20.19.2/node-v20.19.2-linux-x64/bin/node')
class BootstrapTests(unittest.TestCase):
 def test_cjs_and_esm_builtin_exports_are_guarded_without_network(self):
  self.assertEqual(hashlib.sha256(NODE.read_bytes()).hexdigest(),'b9640779a1fffec1b6beeb90cb05019637457df2bd3e459034216b260a9ad0ac')
  with tempfile.TemporaryDirectory(prefix='r3-guard-dummy-')as tmp:
   r=Path(tmp);r.chmod(0o700);(r/'tmp').mkdir(mode=0o700);(r/'loader.mjs').write_text('// dummy, never imported');(r/'esbuild-dummy').write_text('never executed')
   log=r/'guard.jsonl';config={'schema':1,'sourceCommit':'93557bfba931f8f731807fc9f30f1d88dbafedf1','dbPort':55487,'tsxVersion':'4.23.15','esbuildVersion':'0.28.2','nonce':'123456abcdef','job':'1234567890abcdef1234567890abcdef','site':str(r),'tmpdir':str(r/'tmp'),'log':str(log),'node':str(NODE),'loader':str(r/'loader.mjs'),'esbuildBinaries':[str(r/'esbuild-dummy')],'pins':{str(p):hashlib.sha256(p.read_bytes()).hexdigest()for p in[NODE,r/'loader.mjs',r/'esbuild-dummy']},'cgroup':'mock-only','pattern':'^dummy$','testFile':str(r/'never.test.ts')}
   cfg=r/'guard-config.json';cfg.write_text(json.dumps(config));cfg.chmod(0o600)
   code="""import assert from 'node:assert/strict';import {Socket,Server} from 'node:net';import {resolve4} from 'node:dns';import {connect as tlsConnect} from 'node:tls';import {createSocket} from 'node:dgram';import {execSync} from 'node:child_process';import {createRequire} from 'node:module';const require=createRequire(import.meta.url);const pipe=process.env.TMPDIR+'/tsx-'+process.getuid()+'/'+process.ppid+'.pipe';assert.throws(()=>new Socket().connect({path:pipe}),e=>e.code==='ENOENT');assert.throws(()=>new Socket().connect({host:'192.0.2.1',port:25}));assert.throws(()=>require('node:net').connect({host:'192.0.2.1',port:25}));assert.throws(()=>resolve4('example.test'));assert.throws(()=>new (require('node:dns').Resolver)().resolve4('example.test'));assert.throws(()=>new (require('node:dns').promises.Resolver)().resolve4('example.test')); assert.throws(()=>tlsConnect({host:'192.0.2.1',port:443}));assert.throws(()=>createSocket('udp4'));assert.throws(()=>execSync('never-execute'));assert.throws(()=>new Server().listen(0,'0.0.0.0'));assert.throws(()=>fetch('https://example.test'));console.log('dummy builtin denial assertions passed; no original connection invoked');"""
   env={'PATH':'/usr/bin:/bin','HOME':str(r),'LANG':'C.UTF-8','NODE_ENV':'test','DATABASE_URL':'postgres://fixture_only:fixture_only@127.0.0.1:55487/fixture_only','MAIL_PROVIDER':'dev','MAIL_PROVIDERS':'dev','TMPDIR':str(r/'tmp'),'QA_GUARD_CONFIG':str(cfg)}
   out=subprocess.run([str(NODE),'--require',str(ROOT/'node_guard.cjs'),'--input-type=module','--eval',code],env=env,capture_output=True,text=True,timeout=12);self.assertEqual(out.returncode,0,out.stderr);events=[json.loads(s)for s in log.read_text().splitlines()];self.assertEqual(sum(e['kind']=='guard-installed'for e in events),1);self.assertEqual(sum(e.get('category')=='expected-optional-cli-ipc-denial'for e in events),1);self.assertEqual(sum(e.get('category')=='unexpected-denial'for e in events),10);self.assertFalse(any(e['kind']=='allowed'for e in events))
   # A real Node test-runner dummy confirms exact child argv and inherited CJS guard.
   pattern='^real validation route (session|level|stepup|origin|rate) refusal creates no intent and recovers only by admitted exact GET$'
   dummy=r/'dummy.test.mjs';dummy.write_text("import test from 'node:test'; test('real validation route session refusal creates no intent and recovers only by admitted exact GET',()=>{});\n")
   config.update(log=str(r/'child-guard.jsonl'),pattern=pattern,testFile=str(dummy));cfg.write_text(json.dumps(config));cfg.chmod(0o600)
   env['NODE_OPTIONS']='--require='+str(ROOT/'node_guard.cjs')
   result=subprocess.run([str(NODE),'--import',str(r/'loader.mjs'),'--test','--test-concurrency=1','--test-name-pattern='+pattern,'--test-reporter=tap',str(dummy)],env=env,capture_output=True,text=True,timeout=12)
   self.assertEqual(result.returncode,0,result.stderr+result.stdout)
   child_events=[json.loads(s)for s in(r/'child-guard.jsonl').read_text().splitlines()]
   self.assertEqual(len({e['pid']for e in child_events if e['kind']=='guard-installed'}),2)
   self.assertEqual(sum(e.get('nodeTestContext')=='child-v8'for e in child_events),1)
   self.assertFalse(any(e['kind']=='denial'for e in child_events))
if __name__=='__main__':unittest.main()
