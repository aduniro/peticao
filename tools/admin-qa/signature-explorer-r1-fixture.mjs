/** Lightweight development fixture: real Explorador/client, stubbed map only.
 * This does not replace the exact Next artifact/backend qualification.
 * Run with --output-dir <private QA directory> [--port 3171].
 */
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const args = new Map();
for (let i = 2; i < process.argv.length; i += 2) args.set(process.argv[i], process.argv[i + 1]);
if (!args.get("--output-dir")) throw new Error("--output-dir is required");
const output = resolve(args.get("--output-dir"));
const port = Number(args.get("--port") ?? 3171);
if (port !== 3171) throw new Error("Only the explicitly reserved QA port3171 is accepted");
const site = resolve(repository, "site");
const require = createRequire(resolve(site, "package.json"));
const { build } = require("esbuild");
mkdirSync(output, { recursive: true, mode: 0o700 });
const entry = resolve(output, "fixture-entry.tsx");
writeFileSync(entry, `import React from "react";
import { createRoot } from "react-dom/client";
import Explorador from ${JSON.stringify(resolve(site, "src/components/admin/Explorador.tsx"))};
createRoot(document.getElementById("qa")!).render(<Explorador inicial={location.search.slice(1)} actorScope="R1-FICTIONAL-ONLY" cheio={location.pathname.endsWith("/mapa")} />);
`, { mode: 0o600 });
await build({ entryPoints: [entry], outfile: resolve(output, "bundle.js"), bundle: true,
  platform: "browser", format: "iife", target: "chrome114", jsx: "automatic",
  nodePaths: [resolve(site, "node_modules")], tsconfig: resolve(site, "tsconfig.json"),
  define: { "process.env.NODE_ENV": '"production"' }, logLevel: "silent",
  plugins: [{ name: "fixture-map-only", setup(builder) {
    builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: "dynamic", namespace: "qa" }));
    builder.onResolve({ filter: /\/MapaAssinaturas$/ }, () => ({ path: "map", namespace: "qa" }));
    builder.onLoad({ filter: /.*/, namespace: "qa" }, ({ path }) => ({
      contents: path === "dynamic" ? "export default function dynamic(){return function FixtureMap(){return null}}" : "export default function FixtureMap(){return null}", loader: "js",
    }));
  } }],
});
const html = '<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>R1 development fixture</title><div id="qa"></div><script src="/bundle.js"></script></html>';
const server = createServer((request, response) => {
  response.setHeader("Cache-Control", "no-store");
  if (!["GET", "HEAD"].includes(request.method ?? "")) { response.writeHead(405); response.end(); return; }
  const path = new URL(request.url, "http://127.0.0.1").pathname;
  if (path === "/bundle.js") { response.setHeader("Content-Type", "text/javascript"); response.end(readFileSync(resolve(output, "bundle.js"))); }
  else if (["/admin/assinaturas", "/admin/mapa"].includes(path)) { response.setHeader("Content-Type", "text/html; charset=utf-8"); response.end(html); }
  else if (path === "/healthz") { response.setHeader("Content-Type", "application/json"); response.end('{"mode":"development-fixture","realBackend":false}'); }
  else { response.writeHead(503); response.end("Fictional QA: route not supplied"); }
});
server.listen(port, "127.0.0.1", () => console.log(JSON.stringify({ mode: "development-fixture", port, mapStubbed: true, realBackend: false })));
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => server.close(() => process.exit(0)));
