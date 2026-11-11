'use strict';
// Pure fixture serialization copied from pinned contracts. Never verifies a real signature.
const crypto=require('node:crypto'),vm=require('node:vm');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
function textVersion(source){
 // Pinned content-only module: no arbitrary import, filesystem or process access.
 let s=source.replace(/^import .*;\n/gm,'').replace(/export type Doc = \{[\s\S]*?\n\};\n/,'').replace(/: Record<Locale, (?:Doc|string\[\]|string)>/g,'').replace('function foreignIntro(l: Locale): string[]','function foreignIntro(l)').replace(/ as Locale\[\]/g,'').replace(/ as Record<Locale, Doc>/g,'').replace('function estrangeiroPdfPt(countriesPt: string[]): Doc','function estrangeiroPdfPt(countriesPt)').replace(/export /g,'');
 if(/\b(?:require|process|import|fetch)\b/.test(s))throw Error('unexpected content-only module capability');
 const box={createHash:crypto.createHash};vm.runInNewContext(s+'\nthis.answer=TEXT_VERSION;',box,{timeout:1000});
 if(!/^[a-f0-9]{64}$/.test(box.answer))throw Error('content version');return box.answer;
}
module.exports={digest,textVersion};
