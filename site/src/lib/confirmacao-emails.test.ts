import test from "node:test";
import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.APP_URL = "https://sancionaintegral.org";
process.env.MAIL_PROVIDER = "dev";
delete process.env.MAIL_PROVIDERS;

test("depois de confirmar: dois e-mails (cartão da assinatura com a data ORIGINAL + divulgação com o cartaz sem nome) e nada muda ao repetir", async () => {
  const dir = mkdtempSync(join(tmpdir(), "conf2-")); process.env.MAIL_OUTBOX_DIR = dir;
  const dbmod = await import("./db"); await dbmod._openForTests("t_confirmacao_emails");
  const { submit } = await import("./signatures");
  const { POST } = await import("../app/api/confirmar/route");
  const { NextRequest } = await import("next/server");
  const { cachedCpfProvider } = await import("./cpf-cache");
  const { mockProvider } = await import("./cpf-check");
  await cachedCpfProvider(mockProvider({ "52998224725": { nome: "MARIA DA SILVA" } })).lookup("52998224725");
  const mails = () => readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")));
  await submit({ name: "Maria da Silva", email: "maria@unir.br", category: "servidor", consent: true, cpf: "52998224725", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, regionValidated: true, ifesListed: true } as any, { ip: "local" } as any, { nameCheck: "match" });
  const conf = mails()[0];
  const token = new URL(conf.text.match(/https?:\/\/\S+/)![0]).searchParams.get("token")!;
  const req = () => new NextRequest("http://localhost/api/confirmar", { method: "POST", body: JSON.stringify({ token }), headers: { "content-type": "application/json" } });
  const r1 = await (await POST(req())).json();
  assert.equal(r1.result, "ok");
  const all = mails(); assert.equal(all.length, 3, "1 de confirmação + 2 depois de confirmar");
  const [thanks, share] = all.slice(1);
  const sig = (await dbmod.query<any>("SELECT seq, verify_code, confirmed_at FROM signatures WHERE email='maria@unir.br'")).rows[0];
  const { brasilia } = await import("./time");
  const { formatCode } = await import("./verify-code");
  // 1) cartão da assinatura: nome, instituição por extenso, data/hora ORIGINAIS, código e link de verificação
  assert.match(thanks.subject, /confirmada/i);
  assert.ok(thanks.html.includes("Maria da Silva") && thanks.html.includes("UNIR - "), "nome e sigla com o nome por extenso");
  const [d, h] = brasilia(sig.confirmed_at).split(" ");
  assert.ok(thanks.html.includes(`${d} às ${h}`) && thanks.text.includes(`${d} às ${h}`), "horário original da confirmação");
  assert.ok(thanks.html.includes(formatCode(sig.verify_code)) && thanks.html.includes(`https://sancionaintegral.org/verificar/${sig.verify_code}`));
  assert.ok(thanks.html.includes(`https://sancionaintegral.org/api/qr/${sig.verify_code}.png`));
  // 2) divulgação: cartaz pessoal (sem nome), hashtags, botões das 5 redes, baixar e reencaminhar
  assert.match(share.subject, /Divulgue/);
  const ref = (await dbmod.query<any>("SELECT code FROM referrers WHERE signature_id=(SELECT id FROM signatures WHERE email='maria@unir.br')")).rows[0].code;
  assert.ok(share.html.includes(`/api/cartaz/${ref}.png`) && share.html.includes(`/api/cartaz/${ref}?baixar=1`));
  for (const rede of ["whatsapp", "telegram", "x", "facebook", "instagram"]) assert.ok(share.html.includes(`/c/${ref}?r=${rede}`), rede);
  assert.ok(share.html.includes("#SancaoIntegral") && share.html.includes("mailto:?subject="));
  assert.ok(!/Maria/.test(share.html.split("Mensagem pronta")[1].split("</table>")[0].replace(/Olá, <strong>Maria<\/strong>/, "")) , "a mensagem/cartaz não leva o nome");
  // repetir o link: nada é reenviado e a data original não muda
  const r2 = await (await POST(req())).json();
  assert.notEqual(r2.result, "ok");
  assert.equal(mails().length, 3);
  assert.equal((await dbmod.query<any>("SELECT confirmed_at FROM signatures WHERE email='maria@unir.br'")).rows[0].confirmed_at, sig.confirmed_at);
});

test("rótulo da instituição: sigla e nome por extenso (PDF e e-mail)", async () => {
  const { institutionLabel } = await import("./ifes-data");
  assert.match(institutionLabel("UFMT"), /^UFMT - Universidade Federal de Mato Grosso/);
  assert.equal(institutionLabel("Instituto Inventado"), "Instituto Inventado");
  assert.equal(institutionLabel(""), "");
});
