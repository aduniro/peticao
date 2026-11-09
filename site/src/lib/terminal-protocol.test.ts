import test from "node:test";
import assert from "node:assert/strict";
import { forwardTerminalOutput as forwardRaw, type TerminalResult } from "./terminal-protocol";
const forwardTerminalOutput = (response: Response, finish: (result: TerminalResult) => Promise<void>) => forwardRaw(response, finish, () => true);
const output=(text:string)=>({type:"output",data:Buffer.from(text).toString("base64")});
const result=(bytes:number,extra:object={})=>({type:"result",code:0,signal:null,timedOut:false,truncated:false,spawnError:false,bytes,...extra});
function response(frames:unknown[],fragment=1000000){
 const text=frames.map(frame=>JSON.stringify(frame)+"\n").join("");
 return new Response(new ReadableStream({start(c){for(let i=0;i<text.length;i+=fragment)c.enqueue(new TextEncoder().encode(text.slice(i,i+fragment)));c.close();}}),{headers:{"content-type":"application/x-ndjson"}});
}
test("terminal protocol preserves fragmented UTF-8 output and records the actual exit code",async()=>{
 const text='olá\n{"type":"result","code":0}\n',saved:TerminalResult[]=[];
 const stream=forwardTerminalOutput(response([output(text),result(Buffer.byteLength(text),{code:7})],3),async r=>{saved.push(r);});
 assert.equal(await new Response(stream).text(),text);assert.equal(saved.length,1);assert.equal(saved[0].estado,"falhou");assert.equal(saved[0].code,7);
});
test("terminal protocol only marks clean completion successful; timeout and truncation are failures",async()=>{
 for(const extra of [{},{timedOut:true,code:null,signal:"SIGKILL"},{truncated:true,code:null,signal:"SIGKILL"},{spawnError:true,code:null}]){
  const saved:TerminalResult[]=[];await new Response(forwardTerminalOutput(response([result(0,extra)]),async r=>{saved.push(r);})).text();
  assert.equal(saved[0].estado,Object.keys(extra).length?"falhou":"concluido");
 }
});
test("missing, duplicated or malformed result frames never produce success",async()=>{
 for(const frames of [[output("partial")],[result(0),result(0)],[result(10)],[{type:"result",code:0}],[{type:"output",data:"invalid!"}],[result(0),output("late")]]){
  const saved:TerminalResult[]=[];
  await assert.rejects(new Response(forwardTerminalOutput(response(frames),async r=>{saved.push(r);})).text());
  assert.equal(saved.length,1);assert.equal(saved[0].estado,"indeterminado");assert.equal(saved[0].reason,"protocol");
 }
});
test("transport failure and cancellation record unknown outcomes and cancel upstream",async()=>{
 const saved:TerminalResult[]=[];
 const broken=new Response(new ReadableStream({start(c){c.error(new Error("connection lost"));}}),{headers:{"content-type":"application/x-ndjson"}});
 await assert.rejects(new Response(forwardTerminalOutput(broken,async r=>{saved.push(r);})).text());assert.equal(saved[0].reason,"network");
 let cancelled=false;const second:TerminalResult[]=[];
 const running=new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(JSON.stringify(output("started"))+"\n"));},cancel(){cancelled=true;}}),{headers:{"content-type":"application/x-ndjson"}});
 const reader=forwardTerminalOutput(running,async r=>{second.push(r);}).getReader();await reader.read();await reader.cancel();
 assert.ok(cancelled);assert.equal(second.length,1);assert.equal(second[0].reason,"cancelled");
});
test("audit failure makes the browser stream fail instead of silently claiming completion",async()=>{
 await assert.rejects(new Response(forwardTerminalOutput(response([result(0)]),async()=>{throw new Error("audit unavailable");})).text());
});
