import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { AddressInfo } from "node:net";

(process.env as Record<string, string>).NODE_ENV = "test";

/**
 * Intercala o Reacher (verificação da caixa) com a cadeia de envio (brevo → mailrelay → ses), tudo simulado:
 * nada sai da máquina e nenhum endereço real é usado.
 */
test("Reacher + cadeia de provedores: caixa inexistente não envia; domínio lento não trava; falha em provedor cai no seguinte; bounce suprime", async () => {
  let reacherCalls = 0;
  const server = http.createServer((req, res) => {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => {
      const to = JSON.parse(b).to_email as string; reacherCalls++;
      if (to.endsWith("@lento.unir.br") || to.endsWith("@lento.exemplo.org")) return; // nunca responde (porta 25 fechada no destino)
      const fantasma = to.startsWith("fantasma");
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ is_reachable: fantasma ? "invalid" : "unknown", mx: { accepts_mail: true }, syntax: { is_valid_syntax: true }, misc: { is_disposable: false },
        smtp: { can_connect_smtp: true, is_catch_all: false, is_deliverable: !fantasma, is_disabled: fantasma, has_full_inbox: false } }));
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  process.env.REACHER_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  process.env.REACHER_TIMEOUT_MS = "300";
  const dbmod = await import("./db"); await dbmod._openForTests("t_reacher_cadeia");
  const { handleSign, _clearSlowDomains } = await import("./sign-flow");
  const { _clearReacherCache } = await import("./reacher");
  const { _setMxResolverForTests } = await import("./email-check");
  _setMxResolverForTests(async () => "ok"); // DNS simulado: o teste não depende da rede
  const { deliver } = await import("./mail");
  const { suppress, isSuppressed } = await import("./mail/suppression");
  const { query } = dbmod;
  const body = (email: string, cpf: string) => ({ name: "Maria da Silva", email, cpf, category: "apoiador", city: "Porto Velho", uf: "RO", consent: true });
  const provider = { name: "falso", async lookup() { return null; } } as never;
  const ctx = (ip: string) => ({ ip, ua: "teste", locale: "pt" } as never);
  try {
    // 1) caixa inexistente num domínio institucional (unir.br): o Reacher prova e o cadastro nem é criado
    _clearReacherCache(); _clearSlowDomains();
    const r1 = await handleSign({ ...body("fantasma.1@unir.br", "529.982.247-25"), category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true }, ctx("10.0.0.1"), provider);
    assert.equal((r1.json as any).errors?.email, "email_not_found");
    assert.equal(((await query("SELECT count(*)::int n FROM signatures")).rows[0] as any).n, 0);

    // 2) domínio que não responde à sonda: a pessoa espera só o limite (300 ms) e o domínio passa a ser pulado
    const t0 = Date.now();
    await handleSign(body("ana@lento.exemplo.org", "111.444.777-35"), ctx("10.0.0.2"), provider).catch(() => {});
    const primeira = Date.now() - t0;
    const calls = reacherCalls;
    const t1 = Date.now();
    await handleSign(body("bia@lento.exemplo.org", "390.533.447-05"), ctx("10.0.0.3"), provider).catch(() => {});
    assert.ok(primeira < 3000, `1ª consulta lenta limitada (${primeira} ms)`);
    assert.equal(reacherCalls, calls, "domínio lento não é consultado de novo por 30 min");
    assert.ok(Date.now() - t1 < primeira + 50);

    // 3) cadeia: brevo falha → mailrelay falha → ses entrega; cada um com o seu remetente
    const log: string[] = [];
    const senders: Record<string, (m: unknown, from: string) => Promise<void>> = {
      brevo: async () => { log.push("brevo"); throw new Error("Brevo respondeu 401"); },
      mailrelay: async () => { log.push("mailrelay"); throw new Error("Mailrelay respondeu 503"); },
      ses: async (_m: unknown, from: string) => { log.push(`ses:${from}`); },
    };
    const m = { to: "pessoa@exemplo.org", subject: "x", text: "y" };
    assert.equal(await deliver(m, ["brevo", "mailrelay", "ses"], senders as never, (p) => `${p}@remetente.test`), "ses");
    assert.deepEqual(log, ["brevo", "mailrelay", "ses:ses@remetente.test"]);
    // brevo saudável: não toca nos demais
    log.length = 0; senders.brevo = async () => { log.push("brevo-ok"); };
    assert.equal(await deliver(m, ["brevo", "mailrelay", "ses"], senders as never, (p) => p), "brevo");
    assert.deepEqual(log, ["brevo-ok"]);
    // todos falham: erro (o sendMail real manda para a fila de reenvio)
    await assert.rejects(deliver(m, ["mailrelay"], { mailrelay: async () => { throw new Error("fora do ar"); } } as never, (p) => p), /Nenhum provedor/);

    // 4) o provedor devolve (bounce permanente): o endereço é suprimido e a cadeia não o usa mais
    assert.equal(await isSuppressed("bounce@exemplo.org"), false);
    await suppress("bounce@exemplo.org", "bounce", "550 5.1.1 caixa inexistente (simulado)");
    assert.equal(await isSuppressed("bounce@exemplo.org"), true);
    const again = await handleSign(body("bounce@exemplo.org", "529.982.247-25"), ctx("10.0.0.4"), provider);
    assert.ok((again.json as any).errors?.email, "e-mail suprimido é recusado no formulário");
  } finally { _setMxResolverForTests(null); server.close(); delete process.env.REACHER_URL; delete process.env.REACHER_TIMEOUT_MS; }
});
