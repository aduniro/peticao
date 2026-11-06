#!/usr/bin/env node
// Serviço do Terminal do painel: processo SEPARADO do site, sem privilégios (usuário peticao-term, instalado por deploy/22-terminal.sh).
// Escuta só em 127.0.0.1. Só executa um comando se vier com um TICKET assinado pelo site (HMAC), de uso único, válido por 60 s e amarrado ao hash EXATO do comando.
// Um comando por vez, sem terminal interativo, limite de tempo e de saída, ambiente mínimo (sem nenhum segredo do site). Cada comando é registrado no journal.
// Segredo do ticket: $CREDENTIALS_DIRECTORY/segredo (systemd LoadCredential) ou TERMINAL_SECRET_FILE. Variáveis: PORT (3911), TERMINAL_TIMEOUT_S (60), TERMINAL_MAX_SAIDA (200000).
import http from "node:http";
import { spawn } from "node:child_process";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const sha256 = (s) => createHash("sha256").update(s).digest("hex");
export const assinar = (payload, segredo) => createHmac("sha256", segredo).update(payload).digest("hex");
/** Confere o ticket: assinatura, validade e hash do comando. `usados` impede reuso. Devolve { ok, usuario } ou { ok: false, motivo }. */
export function conferirTicket(ticket, comando, segredo, usados, agora = Date.now()) {
  const [payload, sig] = String(ticket ?? "").split(".");
  if (!payload || !sig || !/^[a-f0-9]{64}$/.test(sig)) return { ok: false, motivo: "formato" };
  const esperado = assinar(payload, segredo);
  if (!timingSafeEqual(Buffer.from(esperado), Buffer.from(sig))) return { ok: false, motivo: "assinatura" };
  let t; try { t = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")); } catch { return { ok: false, motivo: "formato" }; }
  if (!t || typeof t.exp !== "number" || typeof t.n !== "string" || typeof t.h !== "string") return { ok: false, motivo: "formato" };
  if (t.exp < agora || t.exp > agora + 120_000) return { ok: false, motivo: "validade" };
  if (t.h !== sha256(comando)) return { ok: false, motivo: "comando" };
  if (usados.has(t.n)) return { ok: false, motivo: "reuso" };
  usados.add(t.n);
  for (const n of usados) if (usados.size > 5000) usados.delete(n); else break;
  return { ok: true, usuario: String(t.u ?? "?").slice(0, 80) };
}

export function criarServidor({ segredo, timeoutS = 60, maxSaida = 200_000, shell = "/bin/bash", log = (m) => console.log(m) }) {
  const usados = new Set(); let ocupado = false;
  return http.createServer((req, res) => {
    const fim = (codigo, msg) => { if (!res.headersSent) res.writeHead(codigo, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" }); res.end(msg); };
    if (req.method !== "POST" || req.url !== "/executar") return fim(404, "não encontrado");
    const partes = []; let tam = 0;
    req.on("data", (c) => { tam += c.length; if (tam > 8192) { req.destroy(); } else partes.push(c); });
    req.on("end", () => {
      let corpo; try { corpo = JSON.parse(Buffer.concat(partes).toString("utf8")); } catch { return fim(400, "pedido inválido"); }
      const comando = corpo?.comando;
      if (typeof comando !== "string" || !comando.trim() || comando.length > 2000 || comando.includes("\0")) return fim(400, "comando inválido");
      const t = conferirTicket(req.headers["x-ticket"], comando, segredo, usados);
      if (!t.ok) { log(`recusado: ${t.motivo}`); return fim(403, "ticket recusado"); }
      if (ocupado) return fim(409, "já há um comando em execução");
      ocupado = true;
      log(`EXECUTA usuario=${t.usuario} comando=${JSON.stringify(comando)}`);
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
      const filho = spawn(shell, ["--noprofile", "--norc", "-c", comando], { cwd: "/tmp", env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: "/tmp", LANG: "C.UTF-8", TERM: "dumb" }, detached: true, stdio: ["ignore", "pipe", "pipe"] });
      let saida = 0, cortado = false;
      const cano = (d) => { if (cortado) return; saida += d.length; if (saida > maxSaida) { cortado = true; res.write("\n[saída cortada: limite atingido]\n"); matar(); return; } res.write(d); };
      const matar = () => { try { process.kill(-filho.pid, "SIGKILL"); } catch { /* já saiu */ } };
      filho.stdout.on("data", cano); filho.stderr.on("data", cano);
      const relogio = setTimeout(() => { cortado = true; res.write(`\n[tempo esgotado: ${timeoutS} s]\n`); matar(); }, timeoutS * 1000);
      res.on("close", () => { if (!filho.killed && filho.exitCode === null) matar(); });
      filho.on("close", (codigo, sinal) => { clearTimeout(relogio); ocupado = false; log(`FIM codigo=${codigo ?? sinal}`); res.end(`\n[saiu com ${codigo ?? sinal}]\n`); });
      filho.on("error", (e) => { clearTimeout(relogio); ocupado = false; res.end(`\n[erro ao iniciar: ${e.message}]\n`); });
    });
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arq = process.env.TERMINAL_SECRET_FILE ?? join(process.env.CREDENTIALS_DIRECTORY ?? "/nao-existe", "segredo");
  let segredo; try { segredo = readFileSync(arq, "utf8").trim(); } catch { console.error("sem segredo do ticket:", arq); process.exit(1); }
  if (segredo.length < 32) { console.error("segredo curto demais"); process.exit(1); }
  const porta = Number(process.env.PORT ?? 3911);
  criarServidor({ segredo, timeoutS: Number(process.env.TERMINAL_TIMEOUT_S ?? 60), maxSaida: Number(process.env.TERMINAL_MAX_SAIDA ?? 200_000) }).listen(porta, "127.0.0.1", () => console.log(`terminal ouvindo em 127.0.0.1:${porta}`));
}
