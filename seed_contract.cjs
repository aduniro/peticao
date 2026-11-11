'use strict';
// Pure fixture serialization copied from pinned contracts. Never verifies a real signature.
const crypto=require('node:crypto'),vm=require('node:vm');
const digest=x=>crypto.createHash('sha256').update(x).digest('hex');
const hmac=(x,pepper)=>crypto.createHmac('sha256',pepper).update(x).digest('hex');
function textVersion(source){
 // Pinned content-only module: no arbitrary import, filesystem or process access.
 let s=source.replace(/^import .*;\n/gm,'').replace(/export type Doc = \{[\s\S]*?\n\};\n/,'').replace(/: Record<Locale, (?:Doc|string\[\]|string)>/g,'').replace('function foreignIntro(l: Locale): string[]','function foreignIntro(l)').replace(/ as Locale\[\]/g,'').replace(/ as Record<Locale, Doc>/g,'').replace('function estrangeiroPdfPt(countriesPt: string[]): Doc','function estrangeiroPdfPt(countriesPt)').replace(/export /g,'');
 if(/\b(?:require|process|import|fetch)\b/.test(s))throw Error('unexpected content-only module capability');
 const box={createHash:crypto.createHash};vm.runInNewContext(s+'\nthis.answer=TEXT_VERSION;',box,{timeout:1000});
 if(!/^[a-f0-9]{64}$/.test(box.answer))throw Error('content version');return box.answer;
}
function protocol(input){
 const {batchId,original,signed,base,artifactId,versionId,selectionId,pepper,textVersion}=input;
 const cpfHash=hmac('president-cpf:v1:52998224725',pepper),policy=digest(JSON.stringify(['http://127.0.0.1:1/validate',digest('QA-R9-ONLY'),['QA-R9-PROOF']]));
 const binding=digest(JSON.stringify([artifactId,textVersion,1,1,cpfHash]));
 const report={protocol:'peticao-base-validation',version:1,valid:true,sha256:digest(base),method:'gov-br-advanced',signerCpfHash:cpfHash,certificateFingerprintSha256:'b'.repeat(64),integrity:true,govBrChainTrusted:true,coverage:'entire-file',modificationsAllowed:true,revocation:'good',profile:'QA-R9-PROOF',validatedAt:new Date().toISOString(),validatorVersion:'qa-r9-synthetic-only'};
 const reportHash=digest(JSON.stringify([JSON.stringify(Object.fromEntries(Object.entries(report).sort(([a],[b])=>a<b?-1:a>b?1:0))),policy]));
 const documentVersion=digest(JSON.stringify([batchId,batchId,'partial',0,1,0,'QA-R9-LIST-'+batchId,digest(original),digest(signed),'icp-brasil',digest(original),digest(signed)]));
 const batch={versionId,sha256:digest(signed),byteLength:signed.length};
 const basePetition={versionId:artifactId,sha256:digest(base),byteLength:base.length,artifactId,validationState:'valid',method:'gov-br-advanced'};
 const attachments=[{role:'batch',...batch,filename:`peticao-plv12-lote-${batchId}-assinado.pdf`,contentType:'application/pdf'},{role:'petition-base',versionId:artifactId,sha256:digest(base),byteLength:base.length,filename:`peticao-base-${artifactId}.pdf`,contentType:'application/pdf'}];
 const manifest={version:2,batchId,documentVersion,batch,basePetition,attachments};return{cpfHash,policy,binding,report,reportHash,documentVersion,manifest,canonical:JSON.stringify(manifest),packageDigest:digest(JSON.stringify(manifest))};
}
function decryptFixtureArchive(id,encrypted,pepper){
 const parts=encrypted.split('.');if(parts.length!==4||parts[0]!=='v1')throw Error('fixture archive version');
 const key=Buffer.from(crypto.hkdfSync('sha256',pepper,'peticao-mail-archive','content-v1',32));const d=crypto.createDecipheriv('aes-256-gcm',key,Buffer.from(parts[1],'hex'));d.setAAD(Buffer.from('mail-content-v1:'+id));d.setAuthTag(Buffer.from(parts[2],'hex'));return JSON.parse(Buffer.concat([d.update(Buffer.from(parts[3],'base64')),d.final()]).toString());
}
module.exports={digest,hmac,textVersion,protocol,decryptFixtureArchive};
