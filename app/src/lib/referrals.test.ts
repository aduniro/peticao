import test from "node:test";
import assert from "node:assert/strict";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _setMxResolverForTests } from "./email-check";
import { mockProvider } from "./cpf-check";

(process.env as Record<string, string>).NODE_ENV = "test";
process.env.MAIL_PROVIDER = "dev";
process.env.MAIL_OUTBOX_DIR = join(tmpdir(), `peticao-outbox-ref-${process.pid}`);
_setMxResolverForTests(async () => "ok");

function cpfFrom(n9: string): string {
  const d = n9.split("").map(Number);
  for (const len of [9, 10]) { const sum = d.slice(0, len).reduce((a, v, i) => a + v * (len + 1 - i), 0); const r = (sum * 10) % 11; d.push(r === 10 ? 0 : r); }
  return d.join("");
}

test("indicações: código pessoal após confirmar, atribuição de assinaturas, acessos e totais", async () => {
  const dbmod = await import("./db");
  await dbmod._openForTests("t_ref");
  const sig = await import("./signatures");
  const ref = await import("./referrals");
  const track = await import("./track");
  const { handleSign } = await import("./sign-flow");
  const { readdirSync, readFileSync } = await import("node:fs");
  const out = process.env.MAIL_OUTBOX_DIR!;
  const tokenOf = () => { const f = readdirSync(out).sort().at(-1)!; return new URL(/https?:\/\/\S+/.exec(JSON.parse(readFileSync(join(out, f), "utf8")).text)![0]).searchParams.get("token")!; };
  const sign = async (name: string, email: string, cpf: string, refCode?: string, visitorId?: string) => {
    const r = await handleSign({ name, email, cpf, category: "servidor", institution: "UNIR", role: "docente", campus: "Ji-Paraná", regionDeclared: true, consent: true }, { ip: "1.1.1.1", refCode, visitorId }, null);
    assert.equal(r.status, 200, JSON.stringify(r.json));
  };

  // Maria assina e confirma → ganha código e painel; token só aparece uma vez
  await sign("Maria da Silva", "maria@unir.br", cpfFrom("300000001"));
  const conf = await sig.confirmFull(tokenOf());
  assert.equal(conf.result, "ok");
  assert.match(conf.code!, ref.CODE_RE);
  assert.ok(conf.manageToken && conf.manageToken.length > 20);
  assert.equal((await sig.confirmFull(tokenOf())).result, "invalid"); // token de uso único
  const byTok = await ref.referrerByToken(conf.manageToken!);
  assert.equal(byTok?.code, conf.code);
  assert.equal(byTok?.display_name, "Maria"); // só o primeiro nome vai ao cartaz
  assert.equal(await ref.referrerByToken("token-errado"), null);
  assert.equal((await dbmod.query("SELECT 1 FROM referrers WHERE manage_token_hash=$1", [conf.manageToken])).rowCount, 0); // o token não é guardado em claro

  // Acessos pelo link: 2 visitantes distintos (um repetido) + robô ignorado + DNT respeitado
  const ev = (vid: string, ua = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36") =>
    track.recordEvent({ visitorId: vid, type: "ref_visit", path: `/r/${conf.code}`, refCode: conf.code, ip: "8.8.8.8", ua });
  assert.equal(await ev("visitor-aaaa1111"), true);
  assert.equal(await ev("visitor-aaaa1111"), true);
  assert.equal(await ev("visitor-bbbb2222"), true);
  assert.equal(await ev("visitor-cccc3333", "Googlebot/2.1 (+http://www.google.com/bot.html)"), false);
  assert.equal(await track.recordEvent({ visitorId: "x", type: "pageview", ip: "1.1.1.1", ua: "Mozilla/5.0" }), false); // id inválido
  assert.equal(await track.recordEvent({ visitorId: "visitor-dddd4444", type: "tipo-invalido", ip: "1.1.1.1", ua: "Mozilla/5.0" }), false);
  assert.equal(track.optedOut(new Headers({ dnt: "1" })), true);
  assert.equal(track.optedOut(new Headers({ "sec-gpc": "1" })), true);
  assert.equal(track.optedOut(new Headers()), false);

  // Dois assinam pelo código de Maria (um confirma); um código inventado é ignorado
  await sign("João Pereira", "joao@unir.br", cpfFrom("300000002"), conf.code, "visitor-aaaa1111");
  await sig.confirmFull(tokenOf());
  await sign("Ana Souza", "ana@unir.br", cpfFrom("300000003"), conf.code, "visitor-bbbb2222"); // fica pendente
  await sign("Beto Lima", "beto@unir.br", cpfFrom("300000004"), "ZZZZZZZ", "visitor-eeee5555");
  assert.equal((await dbmod.query<{ r: string | null }>("SELECT ref_code r FROM signatures WHERE email='beto@unir.br'")).rows[0].r, null);

  const st = await ref.referrerStats(conf.code!);
  assert.deepEqual(st, { visits: 2, signed: 1, pending: 1 });
  const all = await ref.allReferrerStats();
  assert.equal(all.find((r) => r.code === conf.code)?.signed, 1);
  assert.deepEqual((await ref.signersOf(conf.code!)).map((s) => s.name), ["João Pereira", "Ana Souza"]);

  // Código avulso da organização
  const lab = await ref.createLabelReferrer("Sindicato X");
  assert.match(lab.code, ref.CODE_RE);
  assert.equal((await ref.referrerByCode(lab.code))?.label, "Sindicato X");
  assert.equal(await ref.referrerByCode("abc"), null);

  // Monitor: agregação por visitante, mapa e ligação com assinatura
  const mon = await import("./monitor");
  await track.recordEvent({ visitorId: "visitor-aaaa1111", type: "pageview", path: "/", ip: "8.8.8.8", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile Safari/604" });
  await track.recordEvent({ visitorId: "visitor-aaaa1111", type: "click", path: "/", target: "assinar", label: "Assinar", ip: "8.8.8.8", ua: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605 Version/17 Mobile Safari/604" });
  const since = mon.sinceOf("24h");
  const s = await mon.monitorSummary(since);
  assert.equal(s.visitors, 2);
  assert.ok(s.clicks >= 1 && s.pageviews >= 1);
  assert.equal(s.confirmedVisitors, 1); // visitor-aaaa1111 confirmou (João)
  const vis = await mon.monitorVisitors(since);
  const v1 = vis.find((v) => v.visitor_id === "visitor-aaaa1111")!;
  assert.equal(v1.sig_status, "confirmed");
  assert.equal(v1.os, "iOS"); assert.equal(v1.device, "celular"); assert.equal(v1.ip, "8.8.8.8"); assert.equal(v1.ip_version, 4);
  assert.equal(vis.find((v) => v.visitor_id === "visitor-bbbb2222")?.sig_status, "pending");
  const tl = await mon.visitorTimeline("visitor-aaaa1111");
  assert.deepEqual(tl.map((e) => e.type), ["ref_visit", "ref_visit", "pageview", "click"]);
  assert.deepEqual(await mon.visitorTimeline("../etc/passwd"), []);

  // Retenção
  await dbmod.query("UPDATE events SET ts='2000-01-01T00:00:00.000Z' WHERE visitor_id='visitor-bbbb2222'");
  assert.equal(await track.purgeOldEvents(90), 1);

  await dbmod._closeDbForTests();
  rmSync(out, { recursive: true, force: true });
});

test("cartaz: QR, PNG com fonte embutida e textos de compartilhamento", async () => {
  const { cardSvg, ogSvg, iconSvg, renderPng, qrPath } = await import("./card");
  const { shareTexts } = await import("../content/compartilhar");
  const link = "https://exemplo.org.br/r/ABCDEFG";
  assert.match(qrPath(link, 0, 0, 500), /^<path d="M/);
  const png = renderPng(cardSvg({ link, displayLink: "exemplo.org.br/r/ABCDEFG", firstName: "Maria" }), 1080);
  assert.equal(png.subarray(1, 4).toString(), "PNG");
  assert.ok(png.length > 20_000);
  assert.equal(renderPng(ogSvg("exemplo.org.br"), 1200).subarray(1, 4).toString(), "PNG");
  assert.equal(renderPng(iconSvg(), 192).subarray(1, 4).toString(), "PNG");
  const t = shareTexts({ link, firstName: "Maria", audience: "servidor" });
  assert.ok(t.whatsapp.includes(link) && t.emailBody.includes(link) && t.curto.includes(link));
  assert.match(t.whatsapp, /191,00/); assert.match(t.whatsapp, /PLV/);
  assert.match(shareTexts({ link, audience: "apoiador" }).whatsapp, /apoia/);
});
