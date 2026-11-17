import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { freezeOwnConfirmation } from "./president-native-contract";
const bytes = Buffer.from("%PDF-1.7 FICTITIOUS NATIVE PREVIEW ONLY");
const sha=(v:Buffer)=>createHash("sha256").update(v).digest("hex");
const input=()=>({version:1,state:"consumed",method:"own-confirmation",receiptId:"00000000-0000-4000-8000-000000000001",challengeId:"00000000-0000-4000-8000-000000000002",batchId:1,responsibleId:1,documentVersion:"a".repeat(64),sourceSha256:sha(bytes),listHash:"b".repeat(64),accountFingerprint:"c".repeat(64),signerName:"Presidente Fictício",confirmedAt:"2026-11-10T05:45:00.000Z"});
test("canonical receipt binds exact source bytes without claiming authorization, ICP or gov.br",()=>{
 const s=input(),r=freezeOwnConfirmation(s,bytes);assert.ok(r.ok);assert.equal(r.snapshot.sourceSha256,sha(bytes));assert.equal(r.requiresDurableConfirmation,true);assert.equal(r.dispatchAllowed,false);assert.equal(r.icpBrasil,false);assert.equal(r.govBr,false);assert.ok(Object.isFrozen(r.snapshot));
 s.signerName="Outra Pessoa";assert.equal(r.snapshot.signerName,"Presidente Fictício");assert.equal(freezeOwnConfirmation({...input()},Buffer.from(bytes)).ok,true);assert.equal(freezeOwnConfirmation({...input()},Buffer.from("%PDF-1.7 OTHER CONTENT")).ok,false);
});
test("identity, timestamp, batch, document and receipt changes produce different evidence",()=>{
 const original=freezeOwnConfirmation(input(),bytes);assert.ok(original.ok);
 for(const change of [{signerName:"Outra Pessoa"},{responsibleId:2},{batchId:2},{documentVersion:"d".repeat(64)},{listHash:"e".repeat(64)},{accountFingerprint:"f".repeat(64)},{confirmedAt:"2026-11-10T05:46:00.000Z"},{receiptId:"00000000-0000-4000-8000-000000000003"}]){const changed=freezeOwnConfirmation({...input(),...change},bytes);assert.ok(changed.ok);assert.notEqual(changed.evidenceDigest,original.evidenceDigest);}
});
test("issued/revoked states, fake methods and raw credentials/personal identifiers are refused",()=>{
 for(const change of [{state:"issued"},{state:"revoked"},{method:"icp-brasil"},{method:"gov-br-advanced"},{token:"DO_NOT_STORE"},{password:"DO_NOT_STORE"},{cpf:"52998224725"},{birthDate:"1970-01-01"},{signatureKind:"icp-brasil"},{dispatchAllowed:true}])assert.equal(freezeOwnConfirmation({...input(),...change},bytes).ok,false);
});
test("malformed or dangerous receipt data and invalid source PDFs cannot become a snapshot",()=>{
 for(const change of [{batchId:0},{batchId:1.5},{responsibleId:2147483648},{receiptId:"bad"},{documentVersion:"x".repeat(64)},{sourceSha256:"a".repeat(64)},{signerName:" A"},{signerName:"A\nB"},{signerName:"A\u202eB"},{signerName:"X".repeat(201)},{confirmedAt:"2026-02-31T00:00:00.000Z"},{confirmedAt:"2026-11-10T05:45:00-03:00"}])assert.equal(freezeOwnConfirmation({...input(),...change},bytes).ok,false);
 for(const source of [Buffer.from("not a PDF at all"),Buffer.alloc(26*1024*1024),Buffer.from("%PDF-")])assert.equal(freezeOwnConfirmation(input(),source).ok,false);
});

test("serialization never evaluates getters or accepts hidden/prototyped evidence",()=>{
 let evaluated=false;const getter={...input()};Object.defineProperty(getter,"signerName",{get(){evaluated=true;throw Error("must not execute");},enumerable:true});assert.equal(freezeOwnConfirmation(getter,bytes).ok,false);assert.equal(evaluated,false);
 const hidden={...input(),[Symbol("hidden")]:"not-canonical"};assert.equal(freezeOwnConfirmation(hidden,bytes).ok,false);
 const inherited=Object.assign(Object.create({extra:"not-plain-data"}),input());assert.equal(freezeOwnConfirmation(inherited,bytes).ok,false);
});
