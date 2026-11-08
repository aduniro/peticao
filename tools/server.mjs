import http from "node:http";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
const child = spawn(process.execPath, ["--import", "/lab/preload.mjs", "/app/node_modules/next/dist/bin/next", "start", "-H", "127.0.0.1", "-p", "3000"], { stdio: "inherit", env: process.env });
const widget = readFileSync("/lab/turnstile.js");
const proxy = http.createServer((req, res) => {
  if (req.url === "/__lab/turnstile.js") {
    res.writeHead(200, { "content-type": "text/javascript", "cache-control": "no-store" }); res.end(widget); return;
  }
  const headers = { ...req.headers, "accept-encoding": "identity" };
  delete headers.connection;
  const upstream = http.request({ hostname: "127.0.0.1", port: 3000, method: req.method, path: req.url, headers }, response => {
    const type = String(response.headers["content-type"] ?? "");
    if (type.includes("text/html")) {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const html = Buffer.concat(chunks).toString("utf8").replace("<head>", '<head><script src="/__lab/turnstile.js"></script>');
        const h = { ...response.headers, "cache-control": "no-store" }; delete h["content-length"]; delete h["transfer-encoding"];
        res.writeHead(response.statusCode, h); res.end(html);
      });
    } else { res.writeHead(response.statusCode, response.headers); response.pipe(res); }
  });
  upstream.on("error", () => { res.writeHead(503); res.end("Laboratorio iniciando"); });
  req.pipe(upstream);
});
proxy.listen(8080, "0.0.0.0");
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { proxy.close(); child.kill(signal); });
child.on("exit", code => { proxy.close(); process.exitCode = code ?? 1; });
