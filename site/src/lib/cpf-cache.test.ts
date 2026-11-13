import test, { after, before, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cachedCpfProvider, CPF_CACHE_TTL_MS, purgeExpiredCpfCache, type CacheTransaction } from "./cpf-cache";
import { cpfBrasilProvider, ProviderUnavailable, type CpfProvider } from "./cpf-check";
import { query, _openForTests, _closeDbForTests } from "./db";
import { verifyCpfName, verifyIdentity, resetIdentityAttempts } from "./identity";
import { hmac } from "./security";
import { _setMxResolverForTests } from "./email-check";
import { decryptCpfCache } from "./cpf-cache-crypto";
import { cpfCacheContext } from "./cpf-cache";

const CPF = "52998224725";
const RECORD = { nome: "MARIA JOSE DA SILVA", mae: "ANA MARIA DA CONCEICAO", nasc: "15/08/1985", sexo: "F" };
let outbox: string;
before(async () => {
  await _openForTests("t_cpf_cache");
  outbox = mkdtempSync(join(tmpdir(), "cpf-cache-mail-"));
  process.env.MAIL_OUTBOX_DIR = outbox;
  process.env.MAIL_PROVIDER = "dev"; process.env.MAIL_PROVIDERS = "dev";
  _setMxResolverForTests(async () => "ok");
});
beforeEach(async () => {
  await query("DELETE FROM cpf_lookup_cache");
  await query("DELETE FROM identity_attempts");
});
after(async () => {
  _setMxResolverForTests(null);
  await _closeDbForTests();
  rmSync(outbox, { recursive: true, force: true });
});

test("cache: conserva os quatro campos criptografados após recriar o provedor, sem renovar o prazo", async () => {
  let calls = 0, now = Date.now();
  const upstream: CpfProvider = { name: "teste", lookup: async () => { calls++; return { ...RECORD }; } };
  await cachedCpfProvider(upstream, { now: () => now }).lookup(CPF);
  const stored = (await query("SELECT * FROM cpf_lookup_cache")).rows[0];
  assert.equal(stored.cpf_hash, hmac(CPF));
  for (const value of [CPF, RECORD.nome, RECORD.mae, RECORD.nasc]) assert.equal(stored.payload.includes(value), false);
  assert.deepEqual(JSON.parse(decryptCpfCache(stored.payload, cpfCacheContext(hmac(CPF)))!), RECORD);
  assert.equal(new Date(stored.expires_at).getTime() - new Date(stored.fetched_at).getTime(), CPF_CACHE_TTL_MS);
  now += CPF_CACHE_TTL_MS - 1;
  assert.deepEqual(await cachedCpfProvider(upstream, { now: () => now }).lookup(CPF), RECORD);
  assert.equal(calls, 1);
  const after = (await query("SELECT * FROM cpf_lookup_cache")).rows[0];
  assert.equal(+new Date(after.expires_at), +new Date(stored.expires_at));
  now += 1;
  await cachedCpfProvider(upstream, { now: () => now }).lookup(CPF);
  assert.equal(calls, 2, "no limite exato de 30 dias consulta de novo");
});

test("cache: tentativas concorrentes do mesmo CPF fazem uma única consulta", async () => {
  let calls = 0;
  const upstream: CpfProvider = { name: "teste", lookup: async () => { calls++; return { ...RECORD }; } };
  const rows = await Promise.all(Array.from({ length: 12 }, () => cachedCpfProvider(upstream).lookup(CPF)));
  assert.equal(calls, 1); assert.equal(rows.length, 12);
  rows.forEach(r => assert.deepEqual(r, RECORD));
});

test("cache: nome errado pode ser corrigido e mãe/nascimento são recomparados sem nova chamada", async () => {
  let calls = 0;
  const provider = cachedCpfProvider({ name: "teste", lookup: async () => { calls++; return { ...RECORD }; } });
  assert.deepEqual(await verifyCpfName({ cpf: CPF, declaredName: "Carlos Pereira", provider }), { ok: false, reason: "mismatch" });
  assert.deepEqual(await verifyCpfName({ cpf: CPF, declaredName: "Maria José da Silva", provider }), { ok: true, nameCheck: "match" });
  assert.equal((await verifyIdentity({ cpf: CPF, declaredName: "Maria José da Silva", method: "nascimento", value: "16/08/1985", provider })).ok, false);
  assert.equal((await verifyIdentity({ cpf: CPF, declaredName: "Maria José da Silva", method: "nascimento", value: "15/08/1985", provider })).ok, true);
  assert.equal((await verifyIdentity({ cpf: CPF, declaredName: "Maria José da Silva", method: "mae", value: "Ana Maria da Conceição", provider })).ok, true);
  assert.equal(calls, 1);
});

test("cache: mantém cinco erros em 24h; liberar tentativas não exige nova consulta", async () => {
  let calls = 0;
  const provider = cachedCpfProvider({ name: "teste", lookup: async () => { calls++; return { ...RECORD }; } });
  for (let n = 0; n < 5; n++) await verifyCpfName({ cpf: CPF, declaredName: "Carlos Pereira", provider });
  assert.deepEqual(await verifyCpfName({ cpf: CPF, declaredName: "Maria José da Silva", provider }), { ok: false, reason: "locked" });
  await resetIdentityAttempts(CPF);
  assert.equal((await verifyCpfName({ cpf: CPF, declaredName: "Maria José da Silva", provider })).ok, true);
  assert.equal(calls, 1);
});

test("cache: não encontrado e erro da API não são memorizados como recusas", async () => {
  let calls = 0;
  const provider = cachedCpfProvider({ name: "teste", lookup: async () => {
    calls++; if (calls === 1) return null;
    if (calls === 2) throw new ProviderUnavailable("NETWORK");
    return { ...RECORD };
  } });
  assert.equal(await provider.lookup(CPF), null);
  await assert.rejects(() => provider.lookup(CPF), (e: unknown) => e instanceof ProviderUnavailable && e.code === "NETWORK");
  assert.deepEqual(await provider.lookup(CPF), RECORD);
  assert.equal(calls, 3);
});

test("cache: conteúdo adulterado é ignorado; campos expirados são eliminados", async () => {
  let calls = 0;
  const provider = cachedCpfProvider({ name: "teste", lookup: async () => { calls++; return { ...RECORD }; } });
  await provider.lookup(CPF);
  await query("UPDATE cpf_lookup_cache SET payload='v1.adulterado'");
  assert.deepEqual(await provider.lookup(CPF), RECORD);
  assert.equal(calls, 2);
  await query("UPDATE cpf_lookup_cache SET fetched_at=now()-interval '31 days', expires_at=now()-interval '1 day'");
  assert.equal(await purgeExpiredCpfCache(), 1);
  assert.equal((await query("SELECT count(*)::int n FROM cpf_lookup_cache")).rows[0].n, 0);
});

test("cache: falha ao gravar não recusa a pessoa nem cobra a consulta duas vezes", async () => {
  let calls = 0;
  const broken: CacheTransaction = (_key, fn) => fn(null, async () => { throw new Error("storage offline"); });
  const provider = cachedCpfProvider({ name: "teste", lookup: async () => { calls++; return { ...RECORD }; } }, { transaction: broken });
  assert.deepEqual(await provider.lookup(CPF), RECORD);
  assert.equal(calls, 1);
});

test("cache: retorno com CPF de outra pessoa não é guardado", async () => {
  const fetcher = (async () => new Response(JSON.stringify({ success: true, data: { CPF: "11144477735", NOME: "MARIA SILVA", SEXO: "F" } }))) as typeof fetch;
  await assert.rejects(() => cachedCpfProvider(cpfBrasilProvider("CHAVE-FICTICIA", fetcher)).lookup(CPF),
    (e: unknown) => e instanceof ProviderUnavailable && e.code === "CPF_RESPONSE_MISMATCH");
  assert.equal((await query("SELECT count(*)::int n FROM cpf_lookup_cache")).rows[0].n, 0);
});

test("cache: assinatura pendente pode ser refeita e permanece pendente sem nova chamada", async () => {
  const { handleSign } = await import("./sign-flow");
  let calls = 0;
  const provider = cachedCpfProvider({ name: "teste", lookup: async () => { calls++; return { ...RECORD }; } });
  const form = { name: "Maria José da Silva", cpf: CPF, email: "cache-pendente@example.net", category: "apoiador", city: "Porto Velho", uf: "RO", consent: true };
  const ctx = { ip: "10.0.0.44" };
  const start = await handleSign(form, ctx, provider);
  assert.equal(start.json.identityRequired, true);
  const body = { ...form, ticket: start.json.ticket, identity: { method: "nascimento", value: "15/08/1985" } };
  assert.equal((await handleSign(body, ctx, provider)).status, 200);
  const first = (await query("SELECT id,status,cpf_hash FROM signatures WHERE email=$1", [form.email])).rows[0];
  assert.equal(first.status, "pending");
  assert.equal((await handleSign(body, ctx, provider)).status, 200);
  const second = (await query("SELECT id,status,cpf_hash FROM signatures WHERE email=$1", [form.email])).rows[0];
  assert.equal(first.id, second.id); // identical retry preserves the pending request, no new message
  assert.equal(second.status, "pending"); assert.equal(second.cpf_hash, first.cpf_hash);
  assert.equal(calls, 1);
});
