import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type Socket } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { requestA1Worker } from "./a1-worker-client";
import type { A1WorkerBinding } from "./a1-worker-contract";
const hash=(b:Buffer)=>createHash("sha256").update(b).digest("hex");
const original=Buffer.from("%PDF-TRANSPORT-QA");
const binding:A1WorkerBinding={jobId:"11111111-1111-4111-8111-111111111111",documentVersion:"a".repeat(64),inputArtifactVersionId:"22222222-2222-4222-8222-222222222222",inputSha256:hash(original),credentialVersionId:"33333333-3333-4333-8333-333333333333",profileVersion:"pades-basic-unhomologated-v1",trustStoreVersion:"c".repeat(64),expectedCnpj:"15883671000115",certificateFingerprintSha256:"b".repeat(64)};
function response(){const bytes=Buffer.concat([original,Buffer.from("\nsynthetic transport fixture only")]);return{version:1,ok:true,...binding,outputSha256:hash(bytes),pdfBase64:bytes.toString("base64"),report:{version:1,engine:"pyHanko",engineVersion:"0.31.0",integrity:true,chainTrusted:true,holderCnpj:"15883671000115",coverage:"ENTIRE_FILE",docmdpOk:true,fingerprintSha256:binding.certificateFingerprintSha256,trustStoreVersion:binding.trustStoreVersion,profile:binding.profileVersion,environment:"synthetic-test",revocation:"not-required-synthetic-test",timestamp:"not-requested",icpBrasilQualified:false,homologated:false}};}
async function fixture(run:(socket:Socket,request:Record<string,unknown>)=>void,body:()=>Promise<void>){
 const dir=mkdtempSync(join(tmpdir(),"a1-client-")),path=join(dir,"worker.sock");
 const beforeSocket=process.env.A1_WORKER_SOCKET,beforeTimeout=process.env.A1_WORKER_TIMEOUT_MS;
 process.env.A1_WORKER_SOCKET=path;process.env.A1_WORKER_TIMEOUT_MS="150";
 const sockets=new Set<Socket>();let calls=0;
 const server=createServer(socket=>{sockets.add(socket);socket.on("close",()=>sockets.delete(socket));socket.on("error",()=>{});let chunks=Buffer.alloc(0),expected:number|null=null;
  socket.on("data",data=>{chunks=Buffer.concat([chunks,data]);if(expected===null&&chunks.length>=4){expected=chunks.readUInt32BE(0);chunks=chunks.subarray(4);}if(expected!==null&&chunks.length===expected){calls++;run(socket,JSON.parse(chunks.toString()));}});
 });
 server.listen(path);await once(server,"listening");
 try{await body();return calls;}finally{for(const socket of sockets)socket.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));rmSync(dir,{recursive:true,force:true});if(beforeSocket===undefined)delete process.env.A1_WORKER_SOCKET;else process.env.A1_WORKER_SOCKET=beforeSocket;if(beforeTimeout===undefined)delete process.env.A1_WORKER_TIMEOUT_MS;else process.env.A1_WORKER_TIMEOUT_MS=beforeTimeout;}
}
function send(socket:Socket,value:unknown){const body=Buffer.from(JSON.stringify(value)),prefix=Buffer.alloc(4);prefix.writeUInt32BE(body.length);socket.end(Buffer.concat([prefix,body]));}
test("framed Unix transport sends only bound contract and handles fragmented response",async()=>{
 const calls=await fixture((socket,request)=>{assert.equal(request.jobId,binding.jobId);assert.equal("pfxPath" in request,false);const body=Buffer.from(JSON.stringify(response())),prefix=Buffer.alloc(4);prefix.writeUInt32BE(body.length);socket.write(prefix.subarray(0,2));setTimeout(()=>socket.end(Buffer.concat([prefix.subarray(2),body])),5);},async()=>{const result=await requestA1Worker(binding,original);assert.ok(result.ok);assert.equal(result.icpBrasilQualified,false);});assert.equal(calls,1);
});
test("timeout and dropped connection do not retry",async()=>{
 for(const drop of [false,true]){const calls=await fixture(socket=>{if(drop)socket.destroy();},async()=>{const result=await requestA1Worker(binding,original);assert.equal(result.ok,false);});assert.equal(calls,1);}
});
test("oversize, truncated, invalid and mismatched responses fail closed",async()=>{
 const variants=[(socket:Socket)=>{const prefix=Buffer.alloc(4);prefix.writeUInt32BE(0xffffffff);socket.end(prefix);},(socket:Socket)=>{const prefix=Buffer.alloc(4);prefix.writeUInt32BE(100);socket.end(Buffer.concat([prefix,Buffer.from("{}")]))},(socket:Socket)=>send(socket,{...response(),outputSha256:"0".repeat(64)}),(socket:Socket)=>send(socket,{version:1,ok:false,error:"unavailable"})];
 for(const variant of variants)await fixture(socket=>variant(socket),async()=>{assert.equal((await requestA1Worker(binding,original)).ok,false);});
});
test("invalid input never connects to service",async()=>{
 const calls=await fixture(()=>assert.fail("must not connect"),async()=>{assert.equal((await requestA1Worker({...binding,inputSha256:"0".repeat(64)},original)).ok,false);});assert.equal(calls,0);
});
