import fs from 'node:fs';
import {enviar} from '/mnt/apps/peticao-final/peticao/tools/ponte/enviar.mjs';
const request=JSON.parse(fs.readFileSync(0,'utf8'));
if(Object.keys(request).some(k=>!['subject','body'].includes(k))||typeof request.subject!=='string'||typeof request.body!=='string')process.exit(2);
const result=await enviar({para:'operator-1608598f41@example.invalid',assunto:request.subject.slice(0,200),texto:request.body.slice(0,20000)});
console.log(JSON.stringify({status:result.status,id:result.id??null}));
