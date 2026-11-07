import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';
import {registrarEnvioMonitor} from '../ponte/monitor-historico.mjs';
test('monitor records owner metadata only and never message body',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vigia-mail-'));
 try{
 registrarEnvioMonitor({para:'other@example.test',assunto:'no',result:{status:202}},dir);assert.equal(fs.existsSync(path.join(dir,'mail-history.jsonl')),false);
 registrarEnvioMonitor({para:'operator-1608598f41@example.invalid',assunto:'Teste',result:{status:202,id:'provider-1',resposta:'never-store-body'}},dir);
 const file=path.join(dir,'mail-history.jsonl');const row=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(row.state,'accepted');assert.equal(row.id,'provider-1');assert.equal(fs.statSync(file).mode&0o777,0o600);assert.equal(JSON.stringify(row).includes('never-store'),false);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
test('monitor failure does not break delivery result',()=>{assert.doesNotThrow(()=>registrarEnvioMonitor({para:'operator-1608598f41@example.invalid',assunto:'x',result:{status:202}},'/dev/null/not-a-directory'));});
