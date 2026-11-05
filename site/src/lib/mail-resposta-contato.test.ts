import test from "node:test";
import assert from "node:assert/strict";
import { HASHTAGS, campaignMessage } from "../content/compartilhar";
import { RODAPE_RESPOSTA_LINHAS, confirmationHtml, layout, respostaContatoHtml, respostaContatoTexto, shareCampaignHtml } from "./mail/templates";
import { GOV_POINTS } from "../content/governo";

const O = "https://sancionaintegral.org";
const card = { code: "ABC123", message: campaignMessage(`${O}/r/ABC123`), hashtags: HASHTAGS, forwardHref: "mailto:?subject=Assine" };
const paragraphs = ["Obrigado por avisar.", "A sua assinatura foi confirmada em 04/11, às 13h15."];

test("resposta de contato: assinatura sancionaintegral.org, rodapé em três linhas com os logos e card com o QR pessoal", () => {
  const h = respostaContatoHtml({ origin: O, firstName: "Rafael", paragraphs, card });
  assert.match(h, /Olá, <strong>Rafael<\/strong>/);
  assert.match(h, /Um abraço,<br><a href="https:\/\/sancionaintegral\.org"[^>]*>sancionaintegral\.org<\/a>/);
  // rodapé: logos e as três linhas
  assert.ok(h.includes(`${O}/logos/adunir.png`) && h.includes(`${O}/logos/andes.png`));
  for (const linha of RODAPE_RESPOSTA_LINHAS.slice(1)) assert.ok(h.includes(linha.replace(/&/g, "&amp;")), linha);
  assert.match(h, /Petição online pela Sanção Integral do PLV nº 12\/2026 · <a href="https:\/\/sancionaintegral\.org"/);
  assert.ok(!h.includes("sancionaintergral")); // a digitação errada do pedido não vaza
  assert.ok(!h.includes("CNPJ")); // o rodapé padrão (com CNPJ) foi substituído
  // card do layout 4 com o código DA PESSOA
  assert.equal(h.split("/api/cartaz/ABC123.png").length - 1, 1); // uma única imagem grande
  assert.ok(h.includes("/api/cartaz/ABC123?baixar=1"));
  for (const r of ["whatsapp", "telegram", "x", "facebook", "instagram"]) assert.ok(h.includes(`/c/ABC123?r=${r}`), r);
  assert.ok(h.includes(`${O}/r/ABC123`)); // link pessoal de acesso ao site (mede a dispersão)
  assert.match(h, /Mensagem pronta/); assert.match(h, /Baixar o cartaz da campanha/); assert.match(h, /seu QR Code pessoal/);
});

test("resposta de contato: leve e sem práticas ruins para entrega (alt em toda imagem, sem texto escondido, sem pixel, sem script)", () => {
  const h = respostaContatoHtml({ origin: O, firstName: "Cilene", paragraphs, card });
  const imgs = h.match(/<img\b[^>]*>/g) ?? [];
  assert.ok(imgs.length > 0 && imgs.every((i) => /\balt="[^"]+"/.test(i)), "toda imagem precisa de alt");
  assert.ok(imgs.every((i) => i.includes(O)), "imagens só do próprio domínio");
  assert.equal((h.match(/display:none/g) ?? []).length, 1); // só o pré-cabeçalho padrão do layout
  assert.ok(!/<script|<iframe|width="1" height="1"|width="1"[^>]*height="1"/i.test(h));
  assert.ok(Buffer.byteLength(h) < 30_000, `html grande demais: ${Buffer.byteLength(h)}`);
  assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(h)); // nunca CPF
});

test("resposta de contato sem código pessoal (quem não assinou): sem card e sem QR", () => {
  const h = respostaContatoHtml({ origin: O, firstName: "Davi", paragraphs });
  assert.ok(!h.includes("/api/cartaz/") && !h.includes("Mensagem pronta") && !h.includes("/c/"));
  assert.ok(h.includes(`${O}/logos/adunir.png`)); // assinatura e rodapé continuam
  assert.match(h, /sancionaintegral\.org/);
});

test("resposta de contato: o texto digitado é escapado", () => {
  const h = respostaContatoHtml({ origin: O, firstName: "<b>x</b>", paragraphs: ['<script>alert(1)</script> & "aspas"'] });
  assert.ok(!h.includes("<script>alert") && !h.includes("<b>x</b>"));
  assert.ok(h.includes("&lt;script&gt;") && h.includes("&amp;") && h.includes("&quot;aspas&quot;"));
});

test("resposta de contato em texto puro: links, mensagem pronta e rodapé, sem HTML", () => {
  const t = respostaContatoTexto({ origin: O, firstName: "Breno", paragraphs, card });
  assert.match(t, /^Olá, Breno\./);
  assert.ok(t.includes(`${O}/r/ABC123`) && t.includes(`${O}/api/cartaz/ABC123?baixar=1`));
  for (const l of RODAPE_RESPOSTA_LINHAS) assert.ok(t.includes(l), l);
  assert.ok(!/<[a-z][\s\S]*>/i.test(t.replace(/<https?:[^>]*>/g, "")));
  const sem = respostaContatoTexto({ origin: O, firstName: "Davi", paragraphs });
  assert.ok(!sem.includes("/r/") && !sem.includes("cartaz"));
});

test("refatoração: o rodapé padrão e os e-mails existentes não mudaram", () => {
  const padrao = layout({ origin: O, preheader: "p", title: "t", body: "<p>x</p>" });
  assert.ok(padrao.includes("Iniciativa da ADUNIR – Seção Sindical do ANDES-SN") && padrao.includes("CNPJ 15.883.671/0001-15"));
  const outro = layout({ origin: O, preheader: "p", title: "t", body: "<p>x</p>", rodape: "<tr><td>RODAPÉ PRÓPRIO</td></tr>" });
  assert.ok(outro.includes("RODAPÉ PRÓPRIO") && !outro.includes("CNPJ"));
  // o e-mail de divulgação continua com o mesmo card (agora vindo da função reutilizável)
  const share = shareCampaignHtml({ origin: O, firstName: "Ana", code: "ABC123", panel: `${O}/meu/x`, message: card.message, hashtags: HASHTAGS, points: GOV_POINTS, forwardHref: card.forwardHref });
  assert.ok(share.includes("/api/cartaz/ABC123.png?w=540") && share.includes("Reencaminhar para um contato") && share.includes("abrir meu painel"));
  assert.ok(confirmationHtml({ origin: O, firstName: "Ana", link: `${O}/confirmar?token=t`, hours: 48, startedAt: "2026-11-04T10:00:00Z" }).includes("CNPJ 15.883.671/0001-15"));
});
