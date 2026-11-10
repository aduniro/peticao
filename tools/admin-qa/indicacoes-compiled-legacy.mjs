/** Deliberate legacy migration fixture: unlike the main fresh-session scenarios, this seeds one old non-secret client intent. */
import assert from "node:assert/strict";
import { assertPrivateHeaders } from "./indicacoes-compiled-guards.mjs";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
const b=(scope,name)=>scope.getByRole("button",{name,exact:true});
const management=p=>p.getByRole("region",{name:"Gerenciar códigos de organizações",exact:true});
const editor=p=>p.getByRole("region",{name:"Revisar alteração do código",exact:true});
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function poll(check,label){for(let n=0;n<800;n++){if(await check())return;await wait(25);}throw Error("Legacy QA deadline: "+label);}
export async function runIndicacoesLegacyCompiledUi({browser,base,db,U,actor,code,uuid}){
 assert.equal(base,"http://127.0.0.1:3057");assert.equal(process.env.DATABASE_URL,"postgres://peticao:peticao@127.0.0.1:54382/peticao");
 const requestId=randomUUID();assert.ok(uuid(requestId));const row=(await db.query("SELECT id,code,label,admin_version::text version,archived_at FROM referrers WHERE code=$1",[code])).rows[0];assert.ok(row&&row.archived_at===null);
 const {hmac}=await import(pathToFileURL(process.env.QA_SITE_DIR+"/src/lib/security.ts").href);
 const intent={id:row.id,version:row.version,requestId,operation:"edit",label:row.label};
 const oldResult={ok:true,row:{id:row.id,code:row.code,label:row.label,version:row.version,archivedAt:null},changed:false};
 const hash=hmac("admin-referral-mutation:v1:"+JSON.stringify([actor.userId,row.id,row.version,"edit",row.label]));
 await db.query("INSERT INTO admin_referral_mutations(actor_id,request_id,input_hash,referrer_id,result,operation,expected_version)VALUES($1,$2,$3,$4,$5::jsonb,NULL,NULL)",[actor.userId,requestId,hash,row.id,JSON.stringify(oldResult)]);
 const ledgerBefore=(await db.query("SELECT row_to_json(m)::text value FROM admin_referral_mutations m WHERE actor_id=$1 AND request_id=$2",[actor.userId,requestId])).rows[0].value;
 const session=await U.abrirSessao(actor.userId,"127.0.0.1"),fresh=await U.sessaoPorToken(session.token);assert.ok(fresh&&fresh.nivel==="total");
 const key=`admin-referral-management:v1:${fresh.userId}:${fresh.sessaoId}`,referenceKey=`admin-referral-management:legacy-reference:v1:${fresh.userId}:${fresh.sessaoId}`;
 const context=await browser.newContext({viewport:{width:390,height:900},locale:"pt-BR"});const gets=[],posts=[],errors=[],external=[];
 try{
  await context.addCookies([{name:"adm",value:session.token,url:base,httpOnly:true,sameSite:"Lax"}]);
  await context.addInitScript(({key,intent})=>{sessionStorage.setItem(key,JSON.stringify(intent));window.__legacyMutationPosts=0;const original=window.fetch;window.fetch=(...args)=>{const u=args[0]instanceof Request?args[0].url:String(args[0]),method=args[1]?.method??(args[0]instanceof Request?args[0].method:"GET");if(new URL(u,location.origin).pathname==="/api/admin/indicacoes/gestao"&&method.toUpperCase()==="POST")window.__legacyMutationPosts++;return original.apply(window,args);};},{key,intent});
  await context.route("**/*",r=>{const u=new URL(r.request().url());return u.origin===base||u.protocol==="blob:"?r.continue():(external.push(u.hostname),r.abort());});
  await context.route(url=>url.origin===base&&url.pathname==="/api/admin/indicacoes/gestao",async route=>{const request=route.request(),url=new URL(request.url());const input=request.method()==="POST"?request.postDataJSON():null;if(input)assert.ok(uuid(input.requestId));const response=await route.fetch({maxRedirects:0}),bytes=await response.body();assert.ok(bytes.length<=4*1024*1024);const data=JSON.parse(bytes.toString("utf8"));assertPrivateHeaders(response.headers());const record={status:response.status(),query:url.search,input,data};if(input)posts.push(record);else gets.push(record);return route.fulfill({response,body:bytes});});
  const page=await context.newPage();page.on("pageerror",e=>errors.push(e.message));await page.goto(base+"/admin/indicacoes");const scope=management(page);await scope.waitFor();await poll(async()=>await b(scope,"Conferir resultado").isEnabled(),"restore deliberate legacy context");assert.equal(await page.evaluate(()=>window.__legacyMutationPosts),0);
  await b(scope,"Conferir resultado").click();await b(scope,"Abandonar somente a intenção legada local").waitFor();assert.ok(gets.some(r=>new URL(r.query,base).searchParams.get("requestId")===requestId&&r.status===409&&r.data.error==="legacy_unavailable"));assert.equal(await b(scope,"Abandonar somente a intenção legada local").isDisabled(),true);assert.equal(await b(scope,"Repetir a mesma solicitação").count(),0);
  await b(scope,"Consultar organizações").click();await poll(async()=>await scope.getAttribute("aria-busy")==="false","fresh inventory after legacy read");
  const consent=scope.getByRole("checkbox",{name:"Conferi a linha atual e quero abandonar apenas esta intenção local. O resultado antigo continuará não confirmado.",exact:true});await consent.check();await b(scope,"Abandonar somente a intenção legada local").click();assert.equal(posts.length,0);assert.equal(await page.evaluate(()=>window.__legacyMutationPosts),0);
  const storage=await page.evaluate(({key,referenceKey})=>({intent:sessionStorage.getItem(key),reference:JSON.parse(sessionStorage.getItem(referenceKey)??"null")}),{key,referenceKey});assert.equal(storage.intent,null);assert.deepEqual(storage.reference,{requestId,id:row.id,observedVersion:row.version});
  assert.equal((await db.query("SELECT row_to_json(m)::text value FROM admin_referral_mutations m WHERE actor_id=$1 AND request_id=$2",[actor.userId,requestId])).rows[0].value,ledgerBefore);
  const target=scope.locator("tbody>tr").filter({has:page.locator("td>code").filter({hasText:new RegExp("^"+code+"$")})});await b(target,"Editar rótulo").click();await editor(page).getByLabel("Rótulo da organização",{exact:true}).fill("QA Legacy New Explicit Action");assert.equal(posts.length,0);await b(editor(page),"Revisar ação").click();await b(editor(page),"Confirmar ação revisada").click();await scope.getByRole("status").filter({hasText:"Resultado confirmado."}).waitFor();assert.equal(posts.length,1);assert.equal(await page.evaluate(()=>window.__legacyMutationPosts),1);assert.notEqual(posts[0].input.requestId,requestId);assert.equal(posts[0].input.version,row.version);assert.equal(posts[0].status,200);
  const current=(await db.query("SELECT label,admin_version::text version FROM referrers WHERE id=$1",[row.id])).rows[0];assert.equal(current.label,"QA Legacy New Explicit Action");assert.equal(BigInt(current.version),BigInt(row.version)+1n);assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
  return{ok:true,deliberateLegacyFixtureAndIntentSeed:true,mainFreshSessionProofKeptSeparate:true,legacyMetadataBothNull:true,realLegacy409:true,abandonOnlyLocalAfterFreshReadAndConsent:true,oldLedgerUnchanged:true,noLegacyPostReplay:true,newActionExplicitNewUuid:true,referenceRetained:true,newDurableMutation:1,errors,external};
 }finally{await context.close();await U.encerrarSessao(session.token);}
}
