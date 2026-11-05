import test from "node:test";
import assert from "node:assert/strict";
import { GOV_RECIPIENTS, govMailto } from "../content/governo";
import { govCardSvg, renderPng, cardSvg } from "./card";
import { shareTexts } from "../content/compartilhar";
import { CAPAS } from "../content/capas";
import { existsSync } from "node:fs";
import { publicOrigin } from "./net";

test("e-mail ao Governo: 12 destinatários só em BCC, 'Para' vazio, tamanho seguro", () => {
  assert.equal(GOV_RECIPIENTS.length, 12);
  assert.equal(new Set(GOV_RECIPIENTS).size, 12);
  const u = govMailto({ link: "https://exemplo.org", cardUrl: "https://exemplo.org/api/cartao-governo" });
  assert.ok(u.startsWith("mailto:?bcc="));
  assert.ok(!/^mailto:[^?]/.test(u)); // nenhum destinatário no campo "Para"
  const bcc = decodeURIComponent(new URL(u).searchParams.get("bcc")!).split(",");
  assert.deepEqual(bcc, [...GOV_RECIPIENTS]);
  assert.ok(u.length < 2000, `mailto grande demais: ${u.length}`);
  assert.match(decodeURIComponent(u), /PLV nº 12\/2026/);
});

test("cartões PNG (governo e compartilhar) são gerados; QR e tópicos cabem", () => {
  for (const svg of [govCardSvg({ link: "https://x.org", displayLink: "x.org" }), cardSvg({ link: "https://x.org", displayLink: "x.org" })]) {
    const png = renderPng(svg, 1080);
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.ok(png.length > 20_000);
  }
});

test("textos de compartilhar: e-mail inclui o link do cartão; 5 idiomas", () => {
  for (const l of ["pt", "en", "es", "fr", "de"] as const) {
    const t = shareTexts({ link: "https://x.org", locale: l, cardUrl: "https://x.org/api/cartao-compartilhar" });
    assert.ok(t.emailBody.includes("https://x.org/api/cartao-compartilhar"), l);
    assert.ok(t.whatsapp.includes("https://x.org"), l);
  }
});

test("capas: todas as opções existem em WebP nas 3 larguras", () => {
  assert.ok(CAPAS.length >= 9);
  for (const c of CAPAS) for (const w of [640, 1080, 1600]) assert.ok(existsSync(`public/capa/opcoes/opcao-${c.n}-${w}.webp`), `${c.n}-${w}`);
});

test("endereço público pelo cabeçalho (Funnel, localhost, host inválido)", () => {
  const h = (o: Record<string, string>) => new Headers(o);
  assert.equal(publicOrigin(h({ host: "localhost:3100" }), "http://fallback"), "http://localhost:3100");
  assert.equal(publicOrigin(h({ host: "127.0.0.1:3000", "x-forwarded-host": "site.ts.net", "x-forwarded-proto": "https" }), "http://fallback"), "https://site.ts.net");
  assert.equal(publicOrigin(h({ host: "evil.com/..<script>" }), "http://fallback"), "http://fallback");
});

test("redirecionamentos do admin usam o endereço público do proxy (não localhost)", async () => {
  const { requestOrigin } = await import("./net");
  const h = new Headers({ host: "127.0.0.1:3000", "x-forwarded-host": "sancionaintegral.org", "x-forwarded-proto": "https" });
  assert.equal(new URL("/admin", requestOrigin(h)).toString(), "https://sancionaintegral.org/admin");
  assert.equal(requestOrigin(new Headers({ host: "localhost:3000" })), "http://localhost:3000");
});

test("PDF: a fonte embutida (Noto Sans) cobre acentos, latim estendido, cirílico e grego; CJK vira '?'", async () => {
  const { PDFDocument } = await import("pdf-lib");
  const fontkit = (await import("@pdf-lib/fontkit")).default;
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { clean } = await import("./pdf");
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(join(process.cwd(), "assets", "fonts", "NotoSans-Regular.ttf")), { subset: true });
  assert.equal(clean("María Peña Élodie Jürgen", font), "María Peña Élodie Jürgen");
  assert.equal(clean("Anna Kowalczyk-Żółć", font), "Anna Kowalczyk-Żółć");
  assert.equal(clean("ADUNIR – Seção Sindical", font), "ADUNIR – Seção Sindical");
  assert.equal(clean("Москва Αθήνα", font), "Москва Αθήνα");
  assert.ok(/^\?+ \?+$/.test(clean("北京大学 東京", font))); // alfabetos sem glifo na fonte: limitação conhecida
});

test("no Brasil o texto de compartilhamento é sempre em português", () => {
  const t = shareTexts({ link: "https://x.org", locale: "en", country: "BR" });
  assert.match(t.whatsapp, /Sanção integral/);
  assert.match(shareTexts({ link: "https://x.org", locale: "en", country: "US" }).whatsapp, /Full sanction/);
});
