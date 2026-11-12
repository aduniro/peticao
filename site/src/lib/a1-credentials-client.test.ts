import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {mkdtemp,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {credentialBroker,parseCredentialBroker} from "./a1-credentials-client";
import {parseCredentialInput} from "./a1-credentials";
const id="11111111-1111-4111-8111-111111111111",sha="a".repeat(64);
const metadata={credentialVersionId:id,certificateFingerprintSha256:sha,cnpj:"15883671000115",notBefore:"2026-01-01T00:00:00Z",notAfter:"2027-01-01T00:00:00Z",activatedAt:"2026-11-12T10:00:00Z",profileVersion:"pades-ad-rb-declared-unhomologated-v1",trustStoreVersion:sha};
const response={ok:true,credential:metadata,currentCredentialVersionId:id,intent:{requestId:id,state:"completed"}};
test("credential upload parser is bounded, canonical and refuses path/unknown fields",()=>{
 assert.deepEqual(parseCredentialInput({requestId:id}),{requestId:id});
 assert.ok(parseCredentialInput({requestId:id,pfxBase64:Buffer.from("fake-pfx").toString("base64"),password:"fixture"}));
 for(const invalid of [{requestId:id,pfxBase64:"Zg",password:"fixture"},{requestId:id,pfxBase64:"Zg==",password:""},{requestId:id,pfxBase64:"Zg==",password:"fixture",pfxPath:"/etc/private"},{requestId:"bad"},{requestId:id,password:"fixture"}])assert.equal(parseCredentialInput(invalid),null);
});
test("broker parser rejects secret-bearing or malformed metadata",()=>{
 assert.equal(parseCredentialBroker(response).ok,true);
 assert.equal(parseCredentialBroker({...response,credential:{...metadata,password:"DO-NOT-RETURN"}}).ok,false);
 assert.equal(parseCredentialBroker({...response,credential:{...metadata,cnpj:"00000000000000"}}).ok,false);
 assert.deepEqual(parseCredentialBroker({ok:false,error:"private path /etc/secret"}),{ok:false,error:"credential_service_unavailable"});
});
test("Unix broker response fragmented over frames is parsed, socket drop has no retry",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"a1-credential-client-")),path=join(dir,"c.sock"),old=process.env.A1_CREDENTIAL_SOCKET;let count=0;
 const server=createServer(socket=>{count++;let incoming=Buffer.alloc(0);socket.on("data",chunk=>{incoming=Buffer.concat([incoming,chunk]);if(incoming.length<4||incoming.length<4+incoming.readUInt32BE(0))return;const req=JSON.parse(incoming.subarray(4).toString());assert.equal(req.operation,"get");if(count===2)return socket.destroy();const raw=Buffer.from(JSON.stringify(response)),header=Buffer.alloc(4);header.writeUInt32BE(raw.length);socket.write(header.subarray(0,2));socket.write(Buffer.concat([header.subarray(2),raw.subarray(0,9)]));socket.end(raw.subarray(9));});});
 await new Promise<void>(resolve=>server.listen(path,resolve));process.env.A1_CREDENTIAL_SOCKET=path;
 try{assert.equal((await credentialBroker({version:1,operation:"get",requestId:id})).ok,true);assert.equal((await credentialBroker({version:1,operation:"get"})).ok,false);assert.equal(count,2)}finally{if(old===undefined)delete process.env.A1_CREDENTIAL_SOCKET;else process.env.A1_CREDENTIAL_SOCKET=old;await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(dir,{recursive:true,force:true})}
});
