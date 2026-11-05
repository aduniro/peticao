import test from "node:test";
import assert from "node:assert/strict";

(process.env as Record<string, string>).NODE_ENV = "test";

test("painel: IP de Rondônia, rede interna e lista permitida entram; outros estados e países não", async () => {
  const { adminIpAllowed } = await import("./admin");
  assert.equal(await adminIpAllowed("8.8.8.8"), true); // padrão: sem restrição por local
  process.env.ADMIN_GEOFENCE = "1";
  assert.equal(await adminIpAllowed("200.129.140.79"), true);   // Ji-Paraná/RO (RNP)
  assert.equal(await adminIpAllowed("181.220.194.57"), true);   // Porto Velho/RO
  assert.equal(await adminIpAllowed("177.75.1.1"), false);      // Goiás
  assert.equal(await adminIpAllowed("8.8.8.8"), false);         // EUA
  assert.equal(await adminIpAllowed("local"), true);
  assert.equal(await adminIpAllowed("100.109.6.122"), true);    // tailnet
  process.env.ADMIN_ALLOW_IPS = "177.75.1.1, 203.0.113.9";
  assert.equal(await adminIpAllowed("177.75.1.1"), true);
  assert.equal(await adminIpAllowed("203.0.113.10"), false);
  delete process.env.ADMIN_ALLOW_IPS;
  delete process.env.ADMIN_GEOFENCE;
});
