import assert from "node:assert/strict";
import fs from "node:fs";
import dns from "node:dns";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
const run=process.env.PRODUCTION_PROFILE_RUN;
assert.ok(fs.readFileSync(run+"/guard.jsonl","utf8").split("\n").filter(Boolean).map(JSON.parse).some(x=>x.kind==="installed"&&x.pid===process.pid));
const tests=[
 ["dns",()=>dns.lookup("build-fixture.invalid",()=>{})],
 ["tcp",()=>new net.Socket().connect({host:"127.0.0.1",port:1})],
 ["tls",()=>tls.connect({host:"127.0.0.1",port:1})],
 ["udp",()=>dgram.Socket.prototype.send.call({},Buffer.from("fixture"),1,"127.0.0.1")],
 ["fetch",()=>fetch("https://build-fixture.invalid")],
];
const outside=run+"/tmp-escape";
fs.mkdirSync(outside);fs.symlinkSync(outside,run+"/tmp/link");
tests.push(["ipc-escape",()=>new net.Socket().connect({path:run+"/tmp/link/fixture.sock"})]);
for(const [name,act] of tests)assert.throws(act,/PRODUCTION_BUILD_NETWORK_FORBIDDEN/,name);
console.log(JSON.stringify({probes:tests.map(x=>x[0]),deniedBeforeOriginalTransport:true,serviceStarted:false}));
