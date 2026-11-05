import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createBridge } from "../../../tools/preview/egress-bridge.mjs";
import { cpfBridgeProvider, defaultProvider, ProviderUnavailable } from "./cpf-check";
import { egressGet } from "./egress";

async function withBridge(opts: Parameters<typeof createBridge>[0], fn: (sock: string) => Promise<void>) {
  const dir = mkdtempSync(join(tmpdir(), "bridge-"));
  const sock = join(dir, "e.sock");
  const server = http.createServer(createBridge(opts));
  await new Promise<void>((r) => server.listen(sock, r));
  process.env.EGRESS_SOCKET = sock;
  try { await fn(sock); } finally { delete process.env.EGRESS_SOCKET; await new Promise((r) => server.close(r)); rmSync(dir, { recursive: true, force: true }); }
}
const V2 = JSON.stringify({ success: true, data: { CPF: "00000000191", NOME: "RECEITA FEDERAL PARA USO DO SISTEMA", NASC: "30/11/1899", NOME_MAE: "ROSEMAR MARIA P LUNA" } });

test("ponte: repassa só /cpf/<11 dígitos> e /domain/<nome>, com a chave só do lado de fora", async () => {
  const seen: { cpf: string; key: string }[] = [];
  await withBridge({ getKey: () => "CHAVE-SECRETA-TESTE", upstream: async (cpf, key) => { seen.push({ cpf, key }); return { status: 200, body: V2 }; }, probe: async (d) => ({ ok: d === "mit.edu", reason: "ok" }) }, async () => {
    const r = await egressGet("/cpf/00000000191");
    assert.equal(r.status, 200);
    assert.deepEqual(seen, [{ cpf: "00000000191", key: "CHAVE-SECRETA-TESTE" }]);
    assert.equal(r.body.includes("CHAVE-SECRETA"), false); // a chave nunca volta na resposta
    assert.equal(JSON.parse((await egressGet("/domain/mit.edu")).body).ok, true);
    assert.equal(JSON.parse((await egressGet("/domain/Mit.Edu")).body).ok, true); // caixa ignorada
    // tudo o mais é recusado
    for (const p of ["/cpf/123", "/cpf/000000001911", "/cpf/00000000191/x", "/cpf/abc", "/outro", "/", "/cpf/00000000191?k=1", "/domain/", "/../etc/passwd", "/domain/a/b"]) assert.equal((await egressGet(p)).status, 404, p);
    assert.equal((await egressGet("/domain/localhost")).status, 400);
    assert.equal((await egressGet("/domain/10.0.0.1")).status, 400);
    assert.equal(seen.length, 1); // os recusados nem chegaram à API
  });
});

test("ponte: método diferente de GET, sem chave e limite por minuto", async () => {
  await withBridge({ getKey: () => null }, async (sock) => {
    assert.equal((await egressGet("/cpf/00000000191")).status, 503);
    const post = await new Promise<number>((res) => { const q = http.request({ socketPath: sock, path: "/cpf/00000000191", method: "POST" }, (x) => { x.resume(); res(x.statusCode ?? 0); }); q.end(); });
    assert.equal(post, 405);
  });
  let t = 0;
  await withBridge({ getKey: () => "k", upstream: async () => ({ status: 200, body: V2 }), cpfPerMinute: 3, now: () => t }, async () => {
    for (let i = 0; i < 3; i++) assert.equal((await egressGet("/cpf/00000000191")).status, 200);
    assert.equal((await egressGet("/cpf/00000000191")).status, 429);
    t += 61_000; // passou um minuto
    assert.equal((await egressGet("/cpf/00000000191")).status, 200);
  });
});

test("provedor por ponte: registro, não encontrado e erros do serviço", async () => {
  let reply: { status: number; body: string } = { status: 200, body: V2 };
  await withBridge({ getKey: () => "k", upstream: async () => reply }, async () => {
    assert.deepEqual(await cpfBridgeProvider().lookup("00000000191"), { nome: "RECEITA FEDERAL PARA USO DO SISTEMA", mae: "ROSEMAR MARIA P LUNA", nasc: "30/11/1899" });
    reply = { status: 404, body: JSON.stringify({ code: "CPF_NOT_FOUND" }) };
    assert.equal(await cpfBridgeProvider().lookup("00000000191"), null);
    for (const [status, code] of [[401, "INVALID_API_KEY"], [401, "TOKEN_EXPIRED"], [401, "QUOTA_EXCEEDED"], [401, "PLAN_EXPIRED"], [500, "DATABASE_ERROR"]] as const) {
      reply = { status, body: JSON.stringify({ code }) };
      await assert.rejects(() => cpfBridgeProvider().lookup("00000000191"), (e: any) => e instanceof ProviderUnavailable && e.code === code);
    }
    reply = { status: 502, body: JSON.stringify({ code: "NETWORK" }) };
    await assert.rejects(() => cpfBridgeProvider().lookup("00000000191"), (e: any) => e.code === "NETWORK");
  });
  process.env.EGRESS_SOCKET = "/nao/existe.sock"; // ponte fora do ar
  try { await assert.rejects(() => cpfBridgeProvider().lookup("00000000191"), (e: any) => e.code === "BRIDGE_DOWN"); } finally { delete process.env.EGRESS_SOCKET; }
});

test("provedor padrão: ponte > chave > dados de teste", () => {
  const save = { ...process.env };
  try {
    (process.env as Record<string, string>).NODE_ENV = "test"; process.env.SECRETS_DIR = "/nao/existe"; delete process.env.CPF_BRASIL_API_KEY;
    process.env.CPF_MOCK_DATA = JSON.stringify({ "52998224725": { nome: "A B" } });
    delete process.env.EGRESS_SOCKET; delete process.env.CPF_VIA_BRIDGE; delete process.env.CPF_FORCE_MOCK;
    assert.equal(defaultProvider()?.name, "mock");
    process.env.CPF_BRASIL_API_KEY = "k";
    assert.equal(defaultProvider()?.name, "cpf-brasil.org"); // chave real vence o teste
    process.env.CPF_FORCE_MOCK = "1";
    assert.equal(defaultProvider()?.name, "mock"); // …a menos que o teste seja forçado
    delete process.env.CPF_FORCE_MOCK;
    process.env.EGRESS_SOCKET = "/x.sock";
    assert.equal(defaultProvider()?.name, "cpf-brasil.org"); // socket só para domínios: o CPF segue direto
    process.env.CPF_VIA_BRIDGE = "1";
    assert.match(defaultProvider()!.name, /ponte/); // com chave real no computador, o CPF vai pela ponte
    (process.env as Record<string, string>).NODE_ENV = "production"; delete process.env.PREVIEW_MODE; delete process.env.CPF_VIA_BRIDGE; delete process.env.EGRESS_SOCKET; delete process.env.CPF_BRASIL_API_KEY;
    assert.equal(defaultProvider(), null); // em produção o teste nunca é usado
  } finally { for (const k of Object.keys(process.env)) if (!(k in save)) delete process.env[k]; Object.assign(process.env, save); }
});
