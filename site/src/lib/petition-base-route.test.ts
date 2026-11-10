import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { PETITION_BASE_SCHEMA_SQL } from "./petition-base-schema";
import { capturePetitionBaseValidationInput, persistPetitionBaseValidation } from "./petition-base-validation-store";
import { stagePetitionBase } from "./petition-base-store";
import { verifyPetitionBasePdf } from "./petition-base-validation";
import { hmac } from "./security";
const cpf = "52998224725", bytes = Buffer.from("%PDF-1.7 QA BASE STORE synthetic fixture");
const hash = (v: Buffer) => createHash("sha256").update(v).digest("hex");
const variables = ["GOVBR_BASE_ENABLED", "GOVBR_BASE_VALIDATION_ENABLED", "GOVBR_BASE_VALIDATOR_URL", "GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES", "GOVBR_BASE_VALIDATOR_TOKEN", "BATCH_PACKAGE_ENABLED", "BATCH_PACKAGE_MAX_ENCODED_BYTES"];
async function fixture(name: string) {
  const db = await import("./db"); await db._openForTests(name); await db.query(PETITION_BASE_SCHEMA_SQL); await db.query(BATCH_PACKAGE_SCHEMA_SQL);
  await db.query("INSERT INTO admin_users(id,email,nome,nivel,senha_hash)VALUES(1,'qa-base-proof@example.test','QA Total','total','NOT-A-PASSWORD'),(2,'qa-base-reader@example.test','QA Reader','leitura','NOT-A-PASSWORD')");
  const U = await import("./admin-users");
  const session = await U.abrirSessao(1, "127.0.0.1"), readerSession = await U.abrirSessao(2, "127.0.0.1"); await db.query("UPDATE admin_sessions SET stepup_ate=now()+interval '10 minutes'");
  const actor = (await U.sessaoPorToken(session.token))!, reader = (await U.sessaoPorToken(readerSession.token))!;
  const original = Object.fromEntries(variables.map(n => [n, process.env[n]]));
  process.env.GOVBR_BASE_ENABLED = "1"; process.env.GOVBR_BASE_VALIDATION_ENABLED = "1"; process.env.GOVBR_BASE_VALIDATOR_URL = "http://127.0.0.1:1/validate"; process.env.GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES = '["QA-GOVBR-PROOF"]'; process.env.GOVBR_BASE_VALIDATOR_TOKEN = "QA-BASE-ONLY";
  process.env.BATCH_PACKAGE_ENABLED = "1"; delete process.env.BATCH_PACKAGE_MAX_ENCODED_BYTES;
  const profile = { version: 1, revision: 1, responsibleId: 1, cpfHash: hmac("president-cpf:v1:" + cpf), enabled: true, whatsappCipher: null };
  await db.query("INSERT INTO settings(key,value)VALUES('president_profile_v1',$1)", [JSON.stringify(profile)]);
  const staged = await stagePetitionBase({ requestId: randomUUID(), bytes }, actor); assert.ok(staged.ok); const artifactId = staged.artifactId;
  async function proof() {
    const captured = await capturePetitionBaseValidationInput(artifactId, actor); assert.ok(captured.ok);
    const report = { protocol: "peticao-base-validation", version: 1, valid: true, sha256: hash(bytes), method: "gov-br-advanced", signerCpf: cpf, certificateFingerprintSha256: "b".repeat(64), integrity: true, govBrChainTrusted: true, coverage: "entire-file", modificationsAllowed: true, revocation: "good", profile: "QA-GOVBR-PROOF", validatedAt: new Date().toISOString(), validatorVersion: "qa-1" };
    const checked = await verifyPetitionBasePdf(captured.bytes, captured.binding, (async () => new Response(JSON.stringify(report), { headers: { "content-type": "application/json" } })) as typeof fetch); assert.ok(checked.ok);
    return { binding: captured.binding, proof: checked.proof };
  }
  const close = async () => { for (const n of variables) if (original[n] === undefined) delete process.env[n]; else process.env[n] = original[n]; await db._closeDbForTests(); };
  const noSend = async () => assert.equal((await db.query("SELECT 1 FROM mail_messages UNION ALL SELECT 1 FROM mail_outbox UNION ALL SELECT 1 FROM batch_sends")).rowCount, 0);
  return { db, actor, reader, profile, artifactId, proof, close, noSend };
}
import { selectPetitionBase, currentPetitionBaseSelection } from "./petition-base-selection";
async function intent(c: Awaited<ReturnType<typeof fixture>>, expectedRevision = 0) {
  const verified = await c.proof(), saved = await persistPetitionBaseValidation(verified, c.actor); assert.ok(saved.ok);
  return { requestId: randomUUID(), expectedRevision, validationId: saved.validationId, reviewedSha256: hash(bytes), expectedTextVersion: verified.binding.petitionTextVersion };
}

import {BATCH_PACKAGE_SCHEMA_SQL} from "./batch-package-schema";
import {prepareBatchPackage,readFrozenBatchPackage} from "./batch-package-store";
import {documentVersion,type ApprovalRow} from "./batches";
import {appendDocumentVersion} from "./batch-document-history";
async function packetFixture(name:string){
 const c=await fixture(name),chosen=await selectPetitionBase(await intent(c),c.actor);assert.ok(chosen.ok);
 const original=Buffer.from('%PDF-1.7 QA ORIGINAL PACKET fixture'),signed=Buffer.from('%PDF-1.7 QA SIGNED PACKET fixture -- protocol test, not real ICP');
 const batchId=(await c.db.query("INSERT INTO batches(seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf,pdf_sha256,signed_pdf,signed_pdf_sha256,signature_kind)VALUES(1,'partial','prepared',0,1,0,'QA-PACK-LIST',$1,$2,$3,$4,'icp-brasil')RETURNING id",[original,hash(original),signed,hash(signed)])).rows[0].id as number;
 const version=await c.db.tx(client=>appendDocumentVersion(client,{batchId,variant:'signed',bytes:signed,sha256:hash(signed),listHash:'QA-PACK-LIST',signatureKind:'icp-brasil',note:null,source:'upload',authorId:1,recordedBy:1}));
 const row=(await c.db.query<ApprovalRow>('SELECT * FROM batches WHERE id=$1',[batchId])).rows[0];
 const input=()=>({batchId,requestId:randomUUID(),expectedDocumentVersion:documentVersion(row),expectedSelectionId:chosen.selection.selectionId,expectedPackageRevision:0});
 return{...c,original,signed,batchId,version,input};
}

import {NextRequest} from "next/server";
import {createServer,type Server} from "node:http";
import {GET as BASES} from "../app/api/admin/documentos/base/route";
import {GET as CURRENT,POST as SELECT} from "../app/api/admin/documentos/base/selecao/route";
import {POST as VALIDATE} from "../app/api/admin/documentos/base/[id]/validar/route";
import {GET as REVIEW,POST as PREPARE} from "../app/api/admin/lotes/[id]/pacote/route";
let requestNumber=0;
async function requestFactory(c:Awaited<ReturnType<typeof fixture>>){
 const U=await import('./admin-users'),total=await U.abrirSessao(1,'127.0.0.1'),reader=await U.abrirSessao(2,'127.0.0.1');await c.db.query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes'");
 return(method:string,path:string,body?:unknown,token=total.token,origin='http://qa.local')=>new NextRequest('http://qa.local'+path,{method,headers:{host:'qa.local',origin,cookie:'adm='+token,'content-type':'application/json','x-forwarded-for':'192.0.2.'+(++requestNumber)},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
}
async function verifier(onCall?:(bytes:Buffer)=>Promise<void>,valid=true){
 let calls=0;
 const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const b=Buffer.concat(chunks);calls++;assert.equal(req.headers.authorization,'Bearer QA-BASE-ONLY');await onCall?.(b);res.setHeader('content-type','application/json');res.end(JSON.stringify({protocol:'peticao-base-validation',version:1,valid,sha256:hash(b),method:'gov-br-advanced',signerCpf:cpf,certificateFingerprintSha256:'b'.repeat(64),integrity:true,govBrChainTrusted:true,coverage:'entire-file',modificationsAllowed:true,revocation:'good',profile:'QA-GOVBR-PROOF',validatedAt:new Date().toISOString(),validatorVersion:'qa-http-1'}));}catch{res.statusCode=500;res.end('{}');}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');process.env.GOVBR_BASE_VALIDATOR_URL='http://127.0.0.1:'+address.port+'/synthetic-verifier';
 return{calls:()=>calls,close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}

test('base/package HTTP guards require Total, live stepup, same origin and bounded exact commands',async()=>{
 const c=await fixture('t_base_http_guards');try{
  const req=await requestFactory(c),reader=await(await import('./admin-users')).abrirSessao(2,'127.0.0.1');await c.db.query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes'");
  const selection='/api/admin/documentos/base/selecao',base='/api/admin/documentos/base',validation=base+'/'+c.artifactId+'/validar',packet='/api/admin/lotes/1/pacote';
  assert.equal((await BASES(req('GET',base,undefined,''))).status,401);assert.equal((await CURRENT(req('GET',selection,undefined,reader.token))).status,403);assert.equal((await REVIEW(req('GET',packet,undefined,reader.token),{params:{id:'1'}})).status,403);
  assert.equal((await SELECT(req('POST',selection,{},undefined,'https://outside.invalid'))).status,403);
  assert.equal((await SELECT(req('POST',selection,'x'.repeat(2049)))).status,413);assert.equal((await SELECT(req('POST',selection,{proof:'not-accepted'}))).status,400);
  assert.equal((await VALIDATE(req('POST',validation,{expectedSha256:hash(bytes),valid:true}),{params:{id:c.artifactId}})).status,400);
  assert.equal((await PREPARE(req('POST',packet,{}),{params:{id:'01'}})).status,400);
  assert.equal((await BASES(req('GET',base+'?unknown=1'))).status,400);
  await c.db.query('UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1');assert.equal((await BASES(req('GET',base))).status,403);
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_validations UNION ALL SELECT 1 FROM petition_base_selections UNION ALL SELECT 1 FROM batch_packages')).rowCount,0);await c.noSend();
 }finally{await c.close();}
});
test('HTTP synthetic verifier -> explicit selection -> exact package; reads/replays never approve or send',async()=>{
 const c=await packetFixture('t_base_http_flow'),service=await verifier();try{
  const req=await requestFactory(c),base='/api/admin/documentos/base',selection=base+'/selecao',packet='/api/admin/lotes/'+c.batchId+'/pacote',validation=base+'/'+c.artifactId+'/validar',params={params:{id:String(c.batchId)}};
  const listed=await BASES(req('GET',base));assert.equal(listed.status,200);assert.match(listed.headers.get('cache-control')??'',/no-store/);const inventory=await listed.json();assert.equal(inventory.artifacts[0].artifactId,c.artifactId);assert.equal(inventory.artifacts[0].usableInPackage,false);assert.equal(JSON.stringify(inventory).includes('signerCpf'),false);assert.equal(JSON.stringify(inventory).includes('bytes'),false);
  const old=await(await CURRENT(req('GET',selection))).json();assert.equal(old.currentBindingMatches,false);
  assert.equal((await VALIDATE(req('POST',validation,{expectedSha256:'f'.repeat(64)}),{params:{id:c.artifactId}})).status,409);assert.equal(service.calls(),0);
  const checked=await VALIDATE(req('POST',validation,{expectedSha256:hash(bytes)}),{params:{id:c.artifactId}});assert.equal(checked.status,201);const proof=await checked.json();assert.equal(service.calls(),1);assert.equal(proof.usableInPackage,false);assert.equal(JSON.stringify(proof).includes('signerCpf'),false);
  const input={requestId:randomUUID(),expectedRevision:1,validationId:proof.validationId,reviewedSha256:hash(bytes),expectedTextVersion:(await import("@/content/peticao")).TEXT_VERSION};
  const chosen=await SELECT(req('POST',selection,input));assert.equal(chosen.status,201);const selected=await chosen.json();assert.equal((await SELECT(req('POST',selection,input))).status,200);
  const read=await REVIEW(req('GET',packet),params);assert.equal(read.status,200);const review=await read.json();assert.equal(review.canPrepare,true);assert.equal(review.latestPackage,null);
  const prepare={requestId:randomUUID(),expectedDocumentVersion:review.documentVersion,expectedSelectionId:selected.selection.selectionId,expectedPackageRevision:0};
  const frozen=await PREPARE(req('POST',packet,prepare),params);assert.equal(frozen.status,201);const packetResult=await frozen.json();assert.equal(packetResult.package.dispatchAllowed,false);assert.equal((await PREPARE(req('POST',packet,prepare),params)).status,200);
  const after=await(await REVIEW(req('GET',packet),params)).json();assert.equal(after.latestPackage.packageDigest,packetResult.package.packageDigest);assert.equal((await c.db.query('SELECT approved_at FROM batches')).rows[0].approved_at,null);await c.noSend();
 }finally{await service.close();await c.close();}
});
test('revoking the actor during external verification prevents evidence persistence',async()=>{
 const c=await fixture('t_base_http_revoke');let release!:()=>void,started!:()=>void;const ready=new Promise<void>(r=>{started=r;}),hold=new Promise<void>(r=>{release=r;});const service=await verifier(async()=>{started();await hold;});try{
  const req=await requestFactory(c),pending=VALIDATE(req('POST','/api/admin/documentos/base/'+c.artifactId+'/validar',{expectedSha256:hash(bytes)}),{params:{id:c.artifactId}});
  await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('QA verifier did not start')),3000))]);await c.db.query('UPDATE admin_users SET ativo=false WHERE id=1');release();assert.equal((await pending).status,403);assert.equal((await c.db.query('SELECT 1 FROM petition_base_validations')).rowCount,0);await c.noSend();
 }finally{release();await service.close();await c.close();}
});
test('negative external report remains a rejection with no selection, package or transport',async()=>{
 const c=await fixture('t_base_http_invalid'),service=await verifier(undefined,false);try{
  const req=await requestFactory(c),response=await VALIDATE(req('POST','/api/admin/documentos/base/'+c.artifactId+'/validar',{expectedSha256:hash(bytes)}),{params:{id:c.artifactId}});assert.equal(response.status,409);assert.equal(service.calls(),1);
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_validations UNION ALL SELECT 1 FROM petition_base_selections UNION ALL SELECT 1 FROM batch_packages')).rowCount,0);await c.noSend();
 }finally{await service.close();await c.close();}
});
