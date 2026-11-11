'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {textVersion,protocol,digest,decryptFixtureArchive}=require('./seed_contract.cjs');
test('pinned content transform can evaluate dummy content only without imports',()=>{
 const s='import { createHash } from "node:crypto";\nimport type { Locale } from "@/i18n";\nexport type Doc = {\n x: string;\n};\nconst BR: Record<Locale, Doc> = {pt:{x:"a"}};\nconst EST = {pt:{x:"b"}};\nexport const TEXT_VERSION = createHash("sha256").update(JSON.stringify([BR.pt, EST.pt])).digest("hex");';
 assert.equal(textVersion(s),digest(JSON.stringify([{x:'a'},{x:'b'}])));
 assert.throws(()=>textVersion('process.exit();'));
});
test('two-PDF synthetic manifest binds both exact artifacts and classification explicitly',()=>{
 const p=protocol({batchId:1,original:Buffer.from('%PDF-one'),signed:Buffer.from('%PDF-two'),base:Buffer.from('%PDF-base'),artifactId:'99999999-1111-4111-8111-111111111111',versionId:'99999999-0001-4444-8444-000000000001',pepper:'QA',textVersion:'a'.repeat(64)});
 assert.equal(p.manifest.version,2);assert.equal(p.manifest.attachments.length,2);assert.equal(p.packageDigest,digest(p.canonical));assert.equal(p.manifest.attachments[0].sha256,digest(Buffer.from('%PDF-two')));assert.equal(p.report.validatorVersion,'qa-r11-synthetic-only');assert.ok(!('signerCpf'in p.report));assert.equal(p.reportHash.length,64);
});
test('own-fixture encrypted archive authenticates exact bytes and rejects tampering',()=>{
 const id='99999999-1111-4111-8111-111111111111',pepper='QAONLY',value={format:1,to:'qa@example.test',attachments:[{base64:Buffer.from('%PDF-A').toString('base64')},{base64:Buffer.from('%PDF-B').toString('base64')}]};
 const iv=Buffer.alloc(12,1),key=Buffer.from(crypto.hkdfSync('sha256',pepper,'peticao-mail-archive','content-v1',32)),c=crypto.createCipheriv('aes-256-gcm',key,iv);c.setAAD(Buffer.from('mail-content-v1:'+id));const body=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);const encrypted=['v1',iv.toString('hex'),c.getAuthTag().toString('hex'),body.toString('base64')].join('.');
 assert.deepEqual(decryptFixtureArchive(id,encrypted,pepper),value);assert.throws(()=>decryptFixtureArchive(id,encrypted,'WRONG'));
});
