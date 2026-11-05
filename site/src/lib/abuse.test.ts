import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";

test("abuso: 3 tentativas com o mesmo e-mail inexistente o põem na lista negra; o IP NUNCA é bloqueado por erro", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_abuse");
  const { recordInvalidEmail, isEmailBlacklisted } = await import("./abuse");
  const { query } = await import("./db");
  const ip = "203.0.113.7";
  assert.equal(await isEmailBlacklisted("morto@exemplo.org"), false);
  const r1 = await recordInvalidEmail("Morto@Exemplo.org", ip);
  const r2 = await recordInvalidEmail("morto@exemplo.org", ip);
  assert.deepEqual([r1.emailAttempts, r1.emailBlacklisted, r2.emailAttempts, r2.emailBlacklisted], [1, false, 2, false]);
  assert.equal(await isEmailBlacklisted("morto@exemplo.org"), false);
  const r3 = await recordInvalidEmail("morto@exemplo.org", ip); // 3ª tentativa do mesmo e-mail
  assert.deepEqual([r3.emailAttempts, r3.emailBlacklisted], [3, true]);
  assert.equal(await isEmailBlacklisted("MORTO@exemplo.org"), true);
  // muitos erros do mesmo IP (rede compartilhada): contados, mas sem bloqueio nenhum
  for (let i = 0; i < 12; i++) await recordInvalidEmail(`outro${i}@exemplo.org`, ip);
  assert.equal((await query("SELECT 1 FROM ip_blacklist")).rows.length, 0);
  const kinds = (await query<{ kind: string; n: number }>("SELECT kind, COUNT(*)::int n FROM request_log GROUP BY kind ORDER BY kind")).rows;
  assert.deepEqual(kinds.map((k) => [k.kind, k.n]), [["email_blocked", 1], ["email_invalid", 15]]);
  await dbmod._closeDbForTests();
});
