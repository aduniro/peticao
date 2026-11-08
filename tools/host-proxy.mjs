// Internal Docker networks do not publish ports on this host; bind loopback only.
import http from "node:http";
import { execFileSync } from "node:child_process";
const cache = new Map();
function address(version) {
  const old = cache.get(version);
  if (old && Date.now() - old.at < 5000) return old.ip;
  const ip = execFileSync("docker", ["inspect","peticao-laboratorio-app-"+version+"-1","--format","{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(ip)) throw new Error("Local lab address unavailable");
  cache.set(version,{at:Date.now(),ip});return ip;
}
const servers=[];
for (const [version,port] of [["a",3040],["b",3041]]) {
  const server=http.createServer((req,res)=>{
    let ip;
    try {ip=address(version);} catch {res.writeHead(503);res.end("Laboratorio iniciando");return;}
    const upstream=http.request({hostname:ip,port:8080,path:req.url,method:req.method,headers:req.headers},r=>{res.writeHead(r.statusCode,r.headers);r.pipe(res);});
    upstream.on("error",()=>{cache.delete(version);if(!res.headersSent)res.writeHead(503);res.end("Laboratorio iniciando");});
    req.pipe(upstream);
  });
  server.on("error",()=>{for(const s of servers)s.close();process.exitCode=1;});
  server.listen(port,"127.0.0.1");servers.push(server);
}
for(const sig of ["SIGTERM","SIGINT"])process.on(sig,()=>{for(const server of servers)server.close();});
