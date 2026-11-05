import test from "node:test";
import assert from "node:assert/strict";

process.env.ADMIN_PASSWORD = "senha-de-teste-123";
process.env.TURNSTILE_SITE_KEY = "site-key-teste";
process.env.TURNSTILE_SECRET_KEY = "secret-teste";
delete process.env.ADMIN_PASSWORD_FILE;

const realFetch = globalThis.fetch;
let turnstileOk = true; let chamadas = 0;
globalThis.fetch = (async (url: any, init?: any) => {
  if (String(url).includes("challenges.cloudflare.com")) { chamadas++; return { ok: true, json: async () => ({ success: turnstileOk }) } as any; }
  return realFetch(url, init);
}) as typeof fetch;

async function entrar(campos: Record<string, string>, ip: string, origin = "http://localhost:3321") {
  const { POST } = await import("@/app/api/admin/login/route");
  const { NextRequest } = await import("next/server");
  const fd = new FormData(); for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  const req = new NextRequest("http://localhost:3321/api/admin/login", { method: "POST", body: fd, headers: { origin, host: "localhost:3321", "x-forwarded-for": ip } });
  const r = await POST(req);
  return { loc: r.headers.get("location") ?? "", cookie: r.headers.get("set-cookie") ?? "" };
}

test("login do admin: robô, origem, senha, sucesso e limite", async () => {
  turnstileOk = true;
  // sem token do Turnstile (a verificação recusa token vazio antes mesmo de consultar a Cloudflare)
  let r = await entrar({ password: "senha-de-teste-123" }, "10.9.0.1");
  assert.match(r.loc, /erro=robo/); assert.equal(r.cookie, "");
  // Turnstile reprovado pela Cloudflare
  turnstileOk = false;
  r = await entrar({ password: "senha-de-teste-123", turnstile: "tok" }, "10.9.0.2");
  assert.match(r.loc, /erro=robo/); assert.equal(r.cookie, "");
  turnstileOk = true;
  // origem externa
  r = await entrar({ password: "senha-de-teste-123", turnstile: "tok" }, "10.9.0.3", "http://evil.example");
  assert.match(r.loc, /erro=1/); assert.equal(r.cookie, "");
  // senha errada (com robô aprovado)
  r = await entrar({ password: "errada", turnstile: "tok" }, "10.9.0.4");
  assert.match(r.loc, /erro=1/); assert.equal(r.cookie, "");
  // sucesso: cookie httpOnly, SameSite=Strict, validade assinada
  r = await entrar({ password: "senha-de-teste-123", turnstile: "tok" }, "10.9.0.5");
  assert.ok(!/erro=/.test(r.loc));
  assert.match(r.cookie, /^adm=\d+\.[0-9a-f]{64}/); assert.match(r.cookie, /HttpOnly/i); assert.match(r.cookie, /SameSite=strict/i);
  const { tokenAdminValido } = await import("@/lib/admin");
  assert.ok(tokenAdminValido(r.cookie.split(";")[0].slice(4)));
  // limite: 5 tentativas por IP em 15 min; a 6ª é bloqueada mesmo com senha certa
  for (let i = 0; i < 5; i++) await entrar({ password: "errada", turnstile: "tok" }, "10.9.0.6");
  r = await entrar({ password: "senha-de-teste-123", turnstile: "tok" }, "10.9.0.6");
  assert.match(r.loc, /erro=limite/); assert.equal(r.cookie, "");
  assert.ok(chamadas >= 5);
});
