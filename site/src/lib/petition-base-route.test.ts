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
import {POST as VALIDATE, GET as RECOVER_VALIDATION} from "../app/api/admin/documentos/base/[id]/validar/route";
import {GET as REVIEW,POST as PREPARE} from "../app/api/admin/lotes/[id]/pacote/route";
import { validateBase, readBaseValidation } from "./petition-base-request";
import { validationRefusal, releaseUnrecordedValidation, type BasePending } from "./petition-base-view";
let requestNumber=0;
async function requestFactory(c:Awaited<ReturnType<typeof fixture>>){
 const U=await import('./admin-users'),total=await U.abrirSessao(1,'127.0.0.1'),reader=await U.abrirSessao(2,'127.0.0.1');await c.db.query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes'");
 return(method:string,path:string,body?:unknown,token=total.token,origin='http://qa.local')=>new NextRequest('http://qa.local'+path,{method,headers:{host:'qa.local',origin,cookie:'adm='+token,'content-type':'application/json','x-forwarded-for':'192.0.2.'+(++requestNumber)},...(body===undefined?{}:{body:typeof body==='string'?body:JSON.stringify(body)})});
}
async function verifier(onCall?:(bytes:Buffer)=>Promise<void>,valid=true){
 let calls=0;
 const server=createServer(async(req,res)=>{try{const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));const b=Buffer.concat(chunks);calls++;const reportValid=valid;assert.equal(req.headers.authorization,'Bearer QA-BASE-ONLY');await onCall?.(b);res.setHeader('content-type','application/json');res.end(JSON.stringify({protocol:'peticao-base-validation',version:1,valid:reportValid,sha256:hash(b),method:'gov-br-advanced',signerCpf:cpf,certificateFingerprintSha256:'b'.repeat(64),integrity:true,govBrChainTrusted:true,coverage:'entire-file',modificationsAllowed:true,revocation:'good',profile:'QA-GOVBR-PROOF',validatedAt:new Date().toISOString(),validatorVersion:'qa-http-1'}));}catch{res.statusCode=500;res.end('{}');}});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));const address=server.address();assert.ok(address&&typeof address!=='string');process.env.GOVBR_BASE_VALIDATOR_URL='http://127.0.0.1:'+address.port+'/synthetic-verifier';
 return{calls:()=>calls,setValid:(value:boolean)=>{valid=value;},close:()=>new Promise<void>(resolve=>{server.close(()=>resolve());server.closeAllConnections();})};
}

test('base/package HTTP guards require Total, live stepup, same origin and bounded exact commands',async()=>{
 const c=await fixture('t_base_http_guards');try{
  const req=await requestFactory(c),reader=await(await import('./admin-users')).abrirSessao(2,'127.0.0.1');await c.db.query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes'");
  const selection='/api/admin/documentos/base/selecao',base='/api/admin/documentos/base',validation=base+'/'+c.artifactId+'/validar',packet='/api/admin/lotes/1/pacote';
  assert.equal((await BASES(req('GET',base,undefined,''))).status,401);assert.equal((await CURRENT(req('GET',selection,undefined,reader.token))).status,403);assert.equal((await REVIEW(req('GET',packet,undefined,reader.token),{params:{id:'1'}})).status,403);
  assert.equal((await SELECT(req('POST',selection,{},undefined,'https://outside.invalid'))).status,403);
  assert.equal((await SELECT(req('POST',selection,'x'.repeat(2049)))).status,413);assert.equal((await SELECT(req('POST',selection,{proof:'not-accepted'}))).status,400);
  assert.equal((await VALIDATE(req('POST',validation,{requestId:randomUUID(),expectedSha256:hash(bytes),valid:true}),{params:{id:c.artifactId}})).status,400);
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
  assert.equal((await VALIDATE(req('POST',validation,{requestId:randomUUID(),expectedSha256:'f'.repeat(64)}),{params:{id:c.artifactId}})).status,409);assert.equal(service.calls(),0);
  const checked=await VALIDATE(req('POST',validation,{requestId:randomUUID(),expectedSha256:hash(bytes)}),{params:{id:c.artifactId}});assert.equal(checked.status,201);const proof=await checked.json();assert.equal(service.calls(),1);assert.equal(proof.usableInPackage,false);assert.equal(JSON.stringify(proof).includes('signerCpf'),false);
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
  const req=await requestFactory(c),pending=VALIDATE(req('POST','/api/admin/documentos/base/'+c.artifactId+'/validar',{requestId:randomUUID(),expectedSha256:hash(bytes)}),{params:{id:c.artifactId}});
  await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('QA verifier did not start')),3000))]);await c.db.query('UPDATE admin_users SET ativo=false WHERE id=1');release();assert.equal((await pending).status,403);assert.equal((await c.db.query('SELECT 1 FROM petition_base_validations')).rowCount,0);await c.noSend();
 }finally{release();await service.close();await c.close();}
});

for (const gate of [
  { name: "session", status: 401, error: "authentication_required" },
  { name: "level", status: 403, error: "request_rejected" },
  { name: "stepup", status: 403, error: "stepup_required" },
  { name: "origin", status: 403, error: "request_rejected" },
  { name: "rate", status: 429, error: "request_rejected" },
] as const) {
 test(`real validation route ${gate.name} refusal creates no intent and recovers only by admitted exact GET`, async () => {
  const c = await fixture("t_base_http_gate_" + gate.name), service = await verifier();
  try {
   const users = await import("./admin-users"), session = await users.abrirSessao(1, "127.0.0.1");
   await c.db.query("UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes'");
   const input = { requestId: randomUUID(), artifactId: c.artifactId, sha256: hash(bytes) };
   const params = { params: { id: c.artifactId } }, path = "/api/admin/documentos/base/" + c.artifactId + "/validar";
   const index = ["session", "level", "stepup", "origin", "rate"].indexOf(gate.name);
   const gateIp = "198.51.100." + (110 + index), recoveryIp = "198.51.100." + (120 + index);
   let admitted = false, posts = 0, reads = 0;
   const request = (method: string, url: string, body?: string) => new NextRequest("http://qa.local" + url, {
    method,
    headers: { host: "qa.local", origin: !admitted && gate.name === "origin" ? "https://outside.invalid" : "http://qa.local", cookie: "adm=" + (!admitted && gate.name === "session" ? "" : session.token), "content-type": "application/json", "x-forwarded-for": admitted ? recoveryIp : gateIp },
    ...(body === undefined ? {} : { body }),
   });
   if (gate.name === "level") await c.db.query("UPDATE admin_users SET nivel='leitura' WHERE id=1");
   if (gate.name === "stepup") await c.db.query("UPDATE admin_sessions SET stepup_ate=NULL WHERE user_id=1");
   if (gate.name === "rate") {
    // Real route admissions consume its ten-request window; invalid bodies reserve nothing.
    for (let n = 0; n < 10; n++) assert.equal((await VALIDATE(request("POST", path, "{}"), params)).status, 400);
   }
   const snapshot = async () => (await c.db.query("SELECT count(*)::int n FROM petition_base_validation_intents UNION ALL SELECT count(*)::int FROM petition_base_validation_attempts UNION ALL SELECT count(*)::int FROM petition_base_validation_results UNION ALL SELECT count(*)::int FROM petition_base_validations")).rows;
   const before = await snapshot(); assert.ok(before.every(row => row.n === 0));
   const transport = (async (url, init) => {
    const method = init?.method ?? "GET", req = request(method, String(url), typeof init?.body === "string" ? init.body : undefined);
    if (method === "POST") { posts++; return VALIDATE(req, params); }
    reads++; return RECOVER_VALIDATION(req, params);
   }) as typeof fetch;
   const refused = await validateBase(input.artifactId, input.sha256, transport, 5000, input.requestId);
   assert.deepEqual(refused, { kind: "rejected", status: gate.status, error: gate.error });
   const refusal = validationRefusal(refused); assert.ok(refusal);
   const pending: BasePending = { kind: "validation", input, refusal };
   assert.equal(releaseUnrecordedValidation(pending, null), false);
   assert.equal(releaseUnrecordedValidation(pending, await readBaseValidation(input, transport, 5000)), false);
   assert.deepEqual(await snapshot(), before); assert.equal(service.calls(), 0);
   await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=1; UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes' WHERE user_id=1");
   // Independent admitted fixture IP: this does not claim that the old rate window expired.
   admitted = true;
   const recovered = await readBaseValidation(input, transport, 5000);
   assert.deepEqual(recovered, { kind: "rejected", status: 404, error: "not_found" });
   assert.equal(releaseUnrecordedValidation(pending, recovered), true);
   assert.equal(posts, 1); assert.equal(reads, 2); assert.equal(service.calls(), 0);
   assert.deepEqual(await snapshot(), before); await c.noSend();
  } finally { await service.close(); await c.close(); }
 });
}
test('negative external report remains a rejection with no selection, package or transport',async()=>{
 const c=await fixture('t_base_http_invalid'),service=await verifier(undefined,false);try{
  const req=await requestFactory(c),response=await VALIDATE(req('POST','/api/admin/documentos/base/'+c.artifactId+'/validar',{requestId:randomUUID(),expectedSha256:hash(bytes)}),{params:{id:c.artifactId}});assert.equal(response.status,409);assert.equal(service.calls(),1);
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_validations UNION ALL SELECT 1 FROM petition_base_selections UNION ALL SELECT 1 FROM batch_packages')).rowCount,0);await c.noSend();
 }finally{await service.close();await c.close();}
});

test('exact upload, selection and package GET recovery is actor scoped, historical and inert with gates off',async()=>{
 const c=await packetFixture('t_base_http_exact_intents');try{
  const req=await requestFactory(c),uploadRequest=randomUUID(),staged=await stagePetitionBase({requestId:uploadRequest,bytes},c.actor);assert.ok(staged.ok);
  const selectedRequest=(await c.db.query('SELECT request_id FROM petition_base_selections WHERE artifact_id=$1',[c.artifactId])).rows[0].request_id as string;
  const input=c.input(),first=await prepareBatchPackage(input,c.actor);assert.ok(first.ok);
  const second=await prepareBatchPackage({...c.input(),expectedPackageRevision:1},c.actor);assert.ok(second.ok);
  const base='/api/admin/documentos/base',selection=base+'/selecao',packet='/api/admin/lotes/'+c.batchId+'/pacote',params={params:{id:String(c.batchId)}};
  const upload=await BASES(req('GET',base+'?requestId='+uploadRequest));assert.equal(upload.status,200);assert.equal((await upload.json()).artifactId,staged.artifactId);
  const old=await REVIEW(req('GET',packet+'?requestId='+input.requestId),params);assert.equal(old.status,200);const recovered=await old.json();assert.equal(recovered.package.packageId,first.package.packageId);assert.equal(recovered.isCurrent,false);assert.equal(recovered.package.dispatchAllowed,false);
  const own=await CURRENT(req('GET',selection+'?requestId='+selectedRequest));assert.equal(own.status,200);assert.equal((await own.json()).selection.selectionId,input.expectedSelectionId);
  const other=await(await import('./admin-users')).abrirSessao(2,'127.0.0.1');await c.db.query("UPDATE admin_users SET nivel='total' WHERE id=2;UPDATE admin_sessions SET stepup_ate=clock_timestamp()+interval '9 minutes' WHERE user_id=2");
  for(const [handler,path,param]of [[BASES,base+'?requestId='+uploadRequest,undefined],[CURRENT,selection+'?requestId='+selectedRequest,undefined],[REVIEW,packet+'?requestId='+input.requestId,params]]as const)assert.equal((await(handler as any)(req('GET',path,undefined,other.token),param)).status,404);
  const snapshot=async()=>(await c.db.query("SELECT count(*)::int n FROM petition_base_artifacts UNION ALL SELECT count(*)::int FROM petition_base_validations UNION ALL SELECT count(*)::int FROM petition_base_selections UNION ALL SELECT count(*)::int FROM batch_packages")).rows;
  const before=await snapshot();process.env.GOVBR_BASE_ENABLED='0';process.env.BATCH_PACKAGE_ENABLED='0';process.env.GOVBR_BASE_VALIDATION_ENABLED='0';
  assert.equal((await BASES(req('GET',base+'?requestId='+uploadRequest))).status,200);assert.equal((await CURRENT(req('GET',selection+'?requestId='+selectedRequest))).status,200);assert.equal((await REVIEW(req('GET',packet+'?requestId='+input.requestId),params)).status,200);
  assert.equal((await BASES(req('GET',base+'?requestId=bad'))).status,400);assert.equal((await BASES(req('GET',base+'?requestId='+uploadRequest+'&requestId='+uploadRequest))).status,400);assert.equal((await REVIEW(req('GET',packet+'?requestId='+randomUUID()),params)).status,404);assert.deepEqual(await snapshot(),before);await c.noSend();
 }finally{await c.close();}
});


test('a later failed verifier check invalidates earlier positive evidence until a new successful check',async()=>{
 const c=await fixture('t_base_http_negative_supersedes'),service=await verifier();try{
  const req=await requestFactory(c),path='/api/admin/documentos/base/'+c.artifactId+'/validar',params={params:{id:c.artifactId}};
  const positive=await VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params);assert.equal(positive.status,201);const proof=await positive.json();
  service.setValid(false);
  assert.equal((await VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params)).status,409);
  assert.equal((await(await BASES(req('GET','/api/admin/documentos/base'))).json()).artifacts[0].lastValidationId,null);
  const input={requestId:randomUUID(),expectedRevision:0,validationId:proof.validationId,reviewedSha256:hash(bytes),expectedTextVersion:(await import('@/content/peticao')).TEXT_VERSION};
  assert.equal((await selectPetitionBase(input,c.actor)).ok,false,'failed latest verification must block an earlier positive');
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_selections')).rowCount,0);
  service.setValid(true);
  const refreshed=await VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params);assert.ok([200,201].includes(refreshed.status));
  const latest=await refreshed.json();assert.ok((await selectPetitionBase({...input,requestId:randomUUID(),validationId:latest.validationId},c.actor)).ok);
  await c.noSend();
 }finally{await service.close();await c.close();}
});


test('pending and late positive checks cannot supersede a later rejected check',async()=>{
 const c=await fixture('t_base_http_out_of_order');let release!:()=>void,started!:()=>void,count=0;
 const ready=new Promise<void>(r=>{started=r;}),hold=new Promise<void>(r=>{release=r;});
 const service=await verifier(async()=>{if(++count===1){started();await hold;}});
 try{
  const req=await requestFactory(c),path='/api/admin/documentos/base/'+c.artifactId+'/validar',params={params:{id:c.artifactId}};
  const old=await persistPetitionBaseValidation(await c.proof(),c.actor);assert.ok(old.ok);
  const input={requestId:randomUUID(),expectedRevision:0,validationId:old.validationId,reviewedSha256:hash(bytes),expectedTextVersion:(await import('@/content/peticao')).TEXT_VERSION};
  const pending=VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params);
  await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(new Error('QA verifier did not start')),3000))]);
  assert.equal((await selectPetitionBase(input,c.actor)).ok,false,'pending newer check blocks cached positive');
  service.setValid(false);assert.equal((await VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params)).status,409);
  release();assert.equal((await pending).status,409,'late older positive is historical, not current');
  const journal=(await c.db.query('SELECT r.state FROM petition_base_validation_attempts a JOIN petition_base_validation_results r ON r.attempt_id=a.id ORDER BY a.ordinal')).rows;
  assert.deepEqual(journal.map(r=>r.state),['valid','rejected']);
  assert.equal((await selectPetitionBase({...input,requestId:randomUUID()},c.actor)).ok,false);
  for(const table of ['petition_base_validation_attempts','petition_base_validation_results']){
   await assert.rejects(c.db.query('UPDATE '+table+' SET created_at=created_at'),/immutable/);
   await assert.rejects(c.db.query('DELETE FROM '+table),/immutable/);
   await assert.rejects(c.db.query('TRUNCATE '+table+' CASCADE'),/immutable/);
  }
  const before=(await c.db.query('SELECT row_to_json(a)::text v FROM petition_base_validation_attempts a ORDER BY ordinal')).rows;
  await c.db.query(PETITION_BASE_SCHEMA_SQL);await c.db.query(PETITION_BASE_SCHEMA_SQL);
  assert.deepEqual((await c.db.query('SELECT row_to_json(a)::text v FROM petition_base_validation_attempts a ORDER BY ordinal')).rows,before);
  await c.noSend();
 }finally{release();await service.close();await c.close();}
});

test('a newer failed or unavailable check blocks preparation and approval but preserves frozen package history',async()=>{
 const c=await packetFixture('t_base_http_package_guard'),service=await verifier();try{
  const req=await requestFactory(c),path='/api/admin/documentos/base/'+c.artifactId+'/validar',params={params:{id:c.artifactId}};
  const checked=await VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params);assert.equal(checked.status,201);const proof=await checked.json();
  const chosen=await selectPetitionBase({requestId:randomUUID(),expectedRevision:1,validationId:proof.validationId,reviewedSha256:hash(bytes),expectedTextVersion:(await import('@/content/peticao')).TEXT_VERSION},c.actor);assert.ok(chosen.ok);
  const input={...c.input(),expectedSelectionId:chosen.selection.selectionId},frozen=await prepareBatchPackage(input,c.actor);assert.ok(frozen.ok);
  const M=await import('./batch-package-store');
  assert.equal((await M.getBatchPackageReview(c.batchId,c.actor) as any).approvalReady,true);
  service.setValid(false);assert.equal((await VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params)).status,409);
  assert.equal((await M.getBatchPackageReview(c.batchId,c.actor) as any).approvalReady,false);
  assert.equal(await c.db.tx(client=>M.batchPackageDispatchReadyTx(client,frozen.package.packageId)),false);
  assert.equal((await prepareBatchPackage({...input,requestId:randomUUID(),expectedPackageRevision:1},c.actor)).ok,false);
  assert.ok((await M.readFrozenBatchPackage(frozen.package.packageId,c.actor)).ok,'history remains readable');
  service.setValid(true);assert.ok([200,201].includes((await VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params)).status));
  assert.equal((await M.getBatchPackageReview(c.batchId,c.actor) as any).approvalReady,true);
  await service.close();
  assert.equal((await VALIDATE(req('POST',path,{requestId:randomUUID(),expectedSha256:hash(bytes)}),params)).status,409);
  assert.equal((await c.db.query('SELECT state FROM petition_base_validation_results ORDER BY created_at DESC LIMIT 1')).rows[0].state,'unavailable');
  assert.equal((await M.getBatchPackageReview(c.batchId,c.actor) as any).approvalReady,false);
  await c.noSend();
 }finally{await service.close();await c.close();}
});

test('validation replay and exact recovery never repeat an accepted verifier call',async()=>{
 const c=await fixture('t_base_http_intent_recovery');let release!:()=>void,started!:()=>void;
 const ready=new Promise<void>(r=>{started=r;}),hold=new Promise<void>(r=>{release=r;});
 const service=await verifier(async()=>{started();await hold;});
 try{
  const req=await requestFactory(c),path='/api/admin/documentos/base/'+c.artifactId+'/validar',params={params:{id:c.artifactId}};
  const requestId=randomUUID(),input={requestId,expectedSha256:hash(bytes)},query='?requestId='+requestId+'&expectedSha256='+hash(bytes);
  const first=VALIDATE(req('POST',path,input),params);
  await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('fixture did not start')),3000))]);
  const concurrent=await VALIDATE(req('POST',path,input),params);assert.equal(concurrent.status,200);
  const pending=await concurrent.json();assert.equal(pending.state,'pending');assert.equal(pending.requestId,requestId);
  assert.equal((await(await RECOVER_VALIDATION(req('GET',path+query),params)).json()).state,'pending');
  assert.equal(service.calls(),1);release();assert.equal((await first).status,201); // discard response as if connection was lost
  const recovered=await(await RECOVER_VALIDATION(req('GET',path+query),params)).json();assert.equal(recovered.state,'valid');assert.equal(recovered.isCurrent,true);assert.equal(recovered.attemptId,pending.attemptId);
  const replayed=await(await VALIDATE(req('POST',path,input),params)).json();assert.equal(replayed.attemptId,pending.attemptId);assert.equal(service.calls(),1);
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_validation_attempts')).rowCount,1);
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_validation_intents')).rowCount,1);
  assert.equal((await RECOVER_VALIDATION(req('GET',path+query+'&requestId='+requestId),params)).status,400);
  assert.equal((await VALIDATE(req('POST',path,{...input,expectedSha256:'c'.repeat(64)}),params)).status,409);
  const before=(await c.db.query('SELECT row_to_json(i)::text v FROM petition_base_validation_intents i')).rows;
  await c.db.query(PETITION_BASE_SCHEMA_SQL);assert.deepEqual((await c.db.query('SELECT row_to_json(i)::text v FROM petition_base_validation_intents i')).rows,before);
  for(const sql of ['UPDATE petition_base_validation_intents SET created_at=created_at','DELETE FROM petition_base_validation_intents','TRUNCATE petition_base_validation_intents'])await assert.rejects(c.db.query(sql),/immutable/);
  await c.db.query("UPDATE settings SET value=jsonb_set(value::jsonb,'{revision}','2')::text WHERE key='president_profile_v1'");
  const obsolete=await(await RECOVER_VALIDATION(req('GET',path+query),params)).json();assert.equal(obsolete.contextMatches,false);assert.equal(obsolete.isCurrent,false);assert.equal((await VALIDATE(req('POST',path,input),params)).status,409);assert.equal(service.calls(),1);
  await c.db.query('UPDATE admin_sessions SET stepup_ate=NULL');
  assert.equal((await RECOVER_VALIDATION(req('GET',path+query),params)).status,403);assert.equal(service.calls(),1);
  await c.noSend();
 }finally{release();await service.close();await c.close();}
});

test('recovery distinguishes no reservation from obsolete in-flight context',async()=>{
 const c=await fixture('t_base_http_intent_context');let release!:()=>void,started!:()=>void;
 const ready=new Promise<void>(r=>{started=r;}),hold=new Promise<void>(r=>{release=r;});
 const service=await verifier(async()=>{started();await hold;});
 try{
  const req=await requestFactory(c),path='/api/admin/documentos/base/'+c.artifactId+'/validar',params={params:{id:c.artifactId}};
  const requestId=randomUUID(),input={requestId,expectedSha256:hash(bytes)},query='?requestId='+requestId+'&expectedSha256='+hash(bytes);
  process.env.GOVBR_BASE_VALIDATION_ENABLED='0';
  const denied=await VALIDATE(req('POST',path,input),params);assert.equal(denied.status,409);assert.equal((await denied.json()).error,'disabled');
  assert.equal((await RECOVER_VALIDATION(req('GET',path+query),params)).status,404);assert.equal(service.calls(),0);
  process.env.GOVBR_BASE_VALIDATION_ENABLED='1';
  await c.db.query("UPDATE settings SET value=$1 WHERE key='president_profile_v1'",[JSON.stringify({...c.profile,enabled:false})]);
  const noProfile=await VALIDATE(req('POST',path,input),params);assert.equal(noProfile.status,409);assert.equal((await noProfile.json()).error,'profile_unavailable');
  assert.equal((await RECOVER_VALIDATION(req('GET',path+query),params)).status,404);assert.equal(service.calls(),0);
  await c.db.query("UPDATE settings SET value=$1 WHERE key='president_profile_v1'",[JSON.stringify(c.profile)]);
  const pending=VALIDATE(req('POST',path,input),params);await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('fixture did not start')),3000))]);
  process.env.GOVBR_BASE_VALIDATION_ACCEPTED_PROFILES='["QA-CHANGED-POLICY"]';
  const obsolete=await(await RECOVER_VALIDATION(req('GET',path+query),params)).json();assert.equal(obsolete.state,'pending');assert.equal(obsolete.contextMatches,false);assert.equal(obsolete.isCurrent,false);
  release();await pending;assert.equal(service.calls(),1);
  assert.equal((await c.db.query('SELECT 1 FROM petition_base_validation_intents')).rowCount,1);await c.noSend();
 }finally{release();await service.close();await c.close();}
});
