import test from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";
const SEGREDO = "s".repeat(64);
const servico = async (opc: { timeoutS?: number; maxSaida?: number } = {}) => {
  const S = await import("../../scripts/terminal-servico.mjs" as string);
  const srv = S.criarServidor({ segredo: SEGREDO, log: () => {}, ...opc });
  await new Promise<void>((r) => srv.listen(0, "127.0.0.1", () => r()));
  return { S, srv, url: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/executar` };
};
const pedir = async (url: string, comando: string, ticket: string | null) => {
  const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...(ticket ? { "x-ticket": ticket } : {}) }, body: JSON.stringify({ comando }) });
  return { status: r.status, texto: await r.text() };
};

test("terminal: executa com ticket válido e devolve a saída; ticket de uso único", async () => {
  const T = await import("./terminal"); const { srv, url } = await servico();
  try {
    const tk = T.emitirTicket("dona@exemplo.org", "echo olá-mundo", SEGREDO);
    const r = await pedir(url, "echo olá-mundo", tk);
    assert.equal(r.status, 200); assert.match(r.texto, /olá-mundo/); assert.match(r.texto, /\[saiu com 0\]/);
    assert.equal((await pedir(url, "echo olá-mundo", tk)).status, 403); // reuso
  } finally { srv.close(); }
});

test("terminal: recusa sem ticket, assinatura errada, outro comando, vencido e lixo", async () => {
  const T = await import("./terminal"); const { srv, url } = await servico();
  try {
    assert.equal((await pedir(url, "id", null)).status, 403);
    assert.equal((await pedir(url, "id", T.emitirTicket("x", "id", "outra-chave".repeat(8)))).status, 403);
    assert.equal((await pedir(url, "whoami", T.emitirTicket("x", "id", SEGREDO))).status, 403); // ticket amarrado ao hash do comando
    assert.equal((await pedir(url, "id", T.emitirTicket("x", "id", SEGREDO, Date.now() - 120_000))).status, 403); // vencido
    assert.equal((await pedir(url, "id", "lixo.lixo")).status, 403);
    assert.equal((await pedir(url, "", T.emitirTicket("x", "", SEGREDO))).status, 400);
    assert.equal((await pedir(url, "x".repeat(2001), T.emitirTicket("x", "x".repeat(2001), SEGREDO))).status, 400);
  } finally { srv.close(); }
});

test("terminal: ambiente mínimo (sem segredos do site), tempo limite e limite de saída", async () => {
  process.env.TESTE_SEGREDO_SITE = "segredo-do-site"; process.env.TESTE_PEPPER = "pepper-secreto";
  const T = await import("./terminal");
  const a = await servico({ timeoutS: 1 });
  try {
    const env = await pedir(a.url, "env", T.emitirTicket("x", "env", SEGREDO));
    assert.ok(!env.texto.includes("segredo-do-site") && !env.texto.includes("pepper-secreto") && !env.texto.includes(SEGREDO));
    const t0 = Date.now(); const lento = await pedir(a.url, "sleep 10; echo nunca", T.emitirTicket("x", "sleep 10; echo nunca", SEGREDO));
    assert.match(lento.texto, /tempo esgotado/); assert.ok(!lento.texto.includes("nunca")); assert.ok(Date.now() - t0 < 6000);
  } finally { a.srv.close(); }
  const b = await servico({ maxSaida: 1000 });
  try { const c = "yes aaaaaaaaaa | head -c 100000"; const r = await pedir(b.url, c, T.emitirTicket("x", c, SEGREDO)); assert.match(r.texto, /saída cortada/); assert.ok(r.texto.length < 3000); } finally { b.srv.close(); }
});

test("terminal: um comando por vez (o segundo recebe 409)", async () => {
  const T = await import("./terminal"); const { srv, url } = await servico();
  try {
    const c1 = "sleep 1; echo fim";
    const p1 = pedir(url, c1, T.emitirTicket("x", c1, SEGREDO));
    await new Promise((r) => setTimeout(r, 300));
    assert.equal((await pedir(url, "echo oi", T.emitirTicket("x", "echo oi", SEGREDO))).status, 409);
    assert.match((await p1).texto, /fim/);
  } finally { srv.close(); }
});

test("terminal: ligado só por tempo limitado (padrão desligado) e a rota exige total + confirmação extra", async () => {
  const dbmod = await import("./db"); await dbmod._openForTests("t_terminal");
  try {
    const T = await import("./terminal");
    assert.equal(await T.terminalAte(), null);
    const ate = await T.ligarTerminal(1000); // pede demais: limitado a 60
    assert.ok(ate.getTime() - Date.now() <= 60 * 60_000 + 1000 && ate.getTime() - Date.now() > 59 * 60_000);
    assert.ok(await T.terminalAte());
    await T.desligarTerminal(); assert.equal(await T.terminalAte(), null);
    await dbmod.query("INSERT INTO settings(key,value) VALUES('terminal_ate',$1) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [new Date(Date.now() - 1000).toISOString()]);
    assert.equal(await T.terminalAte(), null); // vencido = desligado
    const rota = readFileSync(join(__dirname, "../app/api/admin/terminal/route.ts"), "utf8");
    assert.match(rota, /exigirNivel\(req, "total", \d+, \{ stepup: true \}\)/);
    assert.ok(rota.indexOf("audit(\"terminal_comando\"") < rota.indexOf("executarNoTerminal(s.email")); // registra ANTES de executar
  } finally { await dbmod._closeDbForTests(); }
});

test("terminal: a unidade do serviço é restrita (sem privilégios, sem rede externa, sem segredos do site)", () => {
  const sh = readFileSync(join(__dirname, "../../../deploy/22-terminal.sh"), "utf8");
  for (const linha of ["User=peticao-term", "NoNewPrivileges=yes", "CapabilityBoundingSet=", "ProtectSystem=strict", "IPAddressDeny=any", "IPAddressAllow=127.0.0.1", "LoadCredential=segredo:"]) assert.ok(sh.includes(linha), linha);
  for (const p of ["/opt/peticao", "/etc/peticao", "/var/lib/peticao", "/root", "/home"]) assert.ok(new RegExp(`InaccessiblePaths=.*${p.replace("/", "\\/")}( |$)`, "m").test(sh), p);
  assert.ok(!/sudo|User=root/.test(sh.replace(/#.*$/gm, "")));
});
