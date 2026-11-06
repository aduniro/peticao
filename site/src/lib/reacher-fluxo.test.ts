import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";

(process.env as Record<string, string>).NODE_ENV = "test";

test("fluxo: Reacher recusa só com prova do SMTP e não é chamado quando o CPF é inválido", async () => {
  const seen: string[] = [];
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      const to = JSON.parse(b).to_email as string; seen.push(to);
      const smtp = to.startsWith("fantasma") ? { can_connect_smtp: true, is_deliverable: false, is_disabled: true } : to.startsWith("cheia") ? { can_connect_smtp: true, has_full_inbox: true, is_deliverable: true } : { can_connect_smtp: false };
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ is_reachable: to.startsWith("fantasma") ? "invalid" : "unknown", mx: { accepts_mail: true }, syntax: { is_valid_syntax: true }, misc: { is_disposable: false }, smtp }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.REACHER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const dbmod = await import("./db"); await dbmod._openForTests("t_reacher_fluxo");
  const { handleSign } = await import("./sign-flow");
  const { mockProvider } = await import("./cpf-check");
  const { _clearReacherCache } = await import("./reacher");
  const provider = { name: "espião", async lookup() { throw new Error("não devia consultar a CPF Brasil"); } } as never;
  const cpfProvider = mockProvider({ "52998224725": { nome: "MARIA DA SILVA", mae: "ANA MARIA DA CONCEICAO", nasc: "15/08/1985" } });
  const body = (email: string, cpf = "529.982.247-25") => ({ name: "Maria da Silva", email, cpf, category: "apoiador", city: "Porto Velho", uf: "RO", consent: true });
  try {
    _clearReacherCache();
    // CPF inválido: nem o Reacher nem a CPF Brasil são consultados
    const bad = await handleSign(body("qualquer@gmail.com", "529.982.247-26"), { ip: "9.9.9.1" }, provider);
    assert.equal(bad.status, 422); assert.equal(seen.length, 0);
    // caixa inexistente (prova do SMTP): recusa com o código certo, antes da janela de identidade
    const nf = await handleSign(body("fantasma@gmail.com"), { ip: "9.9.9.2" }, cpfProvider);
    assert.deepEqual((nf.json as { errors: Record<string, string> }).errors, { email: "email_not_found" });
    // caixa cheia
    const full = await handleSign(body("cheia@gmail.com"), { ip: "9.9.9.3" }, cpfProvider);
    assert.deepEqual((full.json as { errors: Record<string, string> }).errors, { email: "email_full" });
    // sem prova (porta 25 fechada → can_connect_smtp=false): NÃO bloqueia; segue o fluxo normal (200 ou pede identidade)
    const ok = await handleSign(body("normal@gmail.com"), { ip: "9.9.9.4" }, cpfProvider);
    assert.equal(ok.status, 200);
    assert.deepEqual(seen, ["fantasma@gmail.com", "cheia@gmail.com", "normal@gmail.com"]);
    // Reacher fora do ar: deixa passar
    server.close(); _clearReacherCache();
    const down = await handleSign(body("outra@gmail.com"), { ip: "9.9.9.5" }, cpfProvider);
    assert.equal(down.status, 200);
  } finally { delete process.env.REACHER_URL; server.close(); await dbmod._closeDbForTests(); }
});
