import test from "node:test";
import assert from "node:assert/strict";
import { signRequest } from "./sign-request";

test('network failure recovers the committed result using a GET, without resending',async()=>{
 const calls:string[]=[];
 const transport:typeof fetch=async(url,init)=>{
  calls.push(`${init?.method??'GET'} ${url}`);
  if(init?.method==='POST') throw new Error('response lost');
  return new Response(JSON.stringify({status:200,json:{ok:true,mail:'queued'}}));
 };
 const result=await signRequest({name:'Fictional Signer'},transport);
 assert.equal(result.data.ok,true);assert.equal(result.data.mail,'queued');assert.deepEqual(calls,['POST /api/assinar','GET /api/assinar/resultado']);
});
test('malformed response and failed recovery remain unknown, never invalid-name or success',async()=>{
 let posts=0;
 const transport:typeof fetch=async(_url,init)=>{if(init?.method==='POST')posts++;return new Response('not-json')};
 const result=await signRequest({},transport);
 assert.equal(posts,1);assert.equal(result.data.resultUnknown,true);assert.equal(result.data.ok,undefined);
});
test('async pending result reuses frozen input and binds resumed POST to the proof',async()=>{
 const bodies:any[]=[];let ready=false,notices=0;
 const input={name:'Fictional Signer',cpf:'fictional'};
 const transport:typeof fetch=async(url,init)=>{
  if(String(url).endsWith('/validacao')) {ready=true;return new Response(JSON.stringify({state:'ready'}));}
  const body=JSON.parse(String(init?.body));bodies.push(body);
  return new Response(JSON.stringify(ready?{identityRequired:true,ticket:'fixture',ncpfToken:'proof'}:{validationPending:true,ncpfToken:'proof'}),{status:ready?200:202});
 };
 const task=signRequest(input,transport,{onPending:()=>{notices++;input.name='Changed during wait';}});
 const result=await task;
 assert.equal(notices,1);assert.equal(result.data.identityRequired,true);
 assert.equal(bodies[1].name,'Fictional Signer');assert.equal(bodies[1].ncpfToken,'proof');
});
test('leaving the form prevents a later automatic resumed submission',async()=>{
 let posts=0,current=true;
 const transport:typeof fetch=async(_url,init)=>{if(init?.method==='POST')posts++;return new Response(JSON.stringify({validationPending:true,ncpfToken:'proof'}),{status:202});};
 const result=await signRequest({},transport,{onPending:()=>{current=false;},isCurrent:()=>current});
 assert.equal(posts,1);assert.equal(result.data.validationPending,true);
});
