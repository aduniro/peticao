/**
 * Gera 5 propostas de layout do e-mail ENVIADO APÓS A CONFIRMAÇÃO da assinatura (o do cartaz e dos botões de compartilhar).
 * Saída local (não vai ao servidor): /mnt/dev/peticao/layouts-email-pos-confirmacao/
 * Reaproveita layout(), button() e esc() de lib/mail/templates.ts (o mesmo cabeçalho/rodapé do e-mail atual) e o cartaz real (lib/card.ts),
 * sem o nome da pessoa e com um QR próprio (/r/CODIGO).
 */
import { mkdirSync, copyFileSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { layout, button, esc } from "../src/lib/mail/templates";
import { govCardSvg, renderPng } from "../src/lib/card";
import { GOV_POINTS } from "../src/content/governo";

const OUT = "/mnt/dev/peticao/layouts-email-pos-confirmacao";
mkdirSync(join(OUT, "logos"), { recursive: true }); mkdirSync(join(OUT, "icones"), { recursive: true });
for (const f of ["adunir.png", "andes.png"]) copyFileSync(join(process.cwd(), "public/logos", f), join(OUT, "logos", f));

const ORIGIN = "https://sancionaintegral.org";
const CODE = "K7M3Q9PX";
const INVITE = `${ORIGIN}/r/${CODE}`;

// cartaz real, sem nome, com o QR deste código
writeFileSync(join(OUT, "cartao-exemplo.png"), renderPng(govCardSvg({ link: INVITE, displayLink: "sancionaintegral.org" }), 1080));

// ícones brancos (os mesmos caminhos do site) em PNG, para os botões
const src = readFileSync(join(process.cwd(), "src/components/ShareButtons.tsx"), "utf8");
const D: Record<string, string> = {};
for (const m of src.matchAll(/^\s{2}(wa|tg|x|fb|ig|mail|dl|share): "([^"]+)"/gm)) D[m[1]] = m[2];
for (const [k, d] of Object.entries(D)) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="48" height="48"><path fill="#ffffff" d="${d}"/></svg>`;
  writeFileSync(join(OUT, "icones", `${k}.png`), Buffer.from(new Resvg(svg, { fitTo: { mode: "width", value: 48 } }).render().asPng()));
}

const GREEN = "#05382a", BRAND = "#0b6b45", YELLOW = "#f5c518", MUTED = "#5b6b63", LINE = "#d5e0da", SOFT = "#eef6f1";
const NET = {
  whatsapp: { nome: "WhatsApp", cor: "#25D366", ic: "wa" },
  telegram: { nome: "Telegram", cor: "#229ED9", ic: "tg" },
  x: { nome: "X (Twitter)", cor: "#000000", ic: "x" },
  facebook: { nome: "Facebook", cor: "#1877F2", ic: "fb" },
  instagram: { nome: "Instagram", cor: "#C13584", ic: "ig" },
} as const;
type Rede = keyof typeof NET;
const REDES = Object.keys(NET) as Rede[];

const HASHTAGS = ["#SancaoIntegral", "#PLV12", "#EducacaoFederal", "#AmazoniaLegal", "#ADUNIR"];
const POINTS = [...GOV_POINTS];
const MSG = `Assine pela sanção integral do PLV nº 12/2026! Educação federal pública na Amazônia Legal e na Faixa de Fronteira.\n${HASHTAGS.join(" ")}\n${INVITE}`;
const firstName = "Maria";

// Cada botão abre a página de compartilhamento da pessoa (/c/CODIGO?r=rede): no celular ela entrega o cartaz E o texto juntos ao app (menu nativo),
// nos demais casos abre a rede com o texto e o link, cuja pré-visualização é o cartaz (og:image do /r/CODIGO).
const shareHref = (r: Rede) => `${ORIGIN}/c/${CODE}?r=${r}`;
const DOWNLOAD = `${ORIGIN}/api/cartaz/${CODE}?baixar=1`;
const PANEL = `${ORIGIN}/meu/EXEMPLO-TOKEN`;
const FORWARD = `mailto:?subject=${encodeURIComponent("Assine: sanção integral do PLV 12/2026")}&body=${encodeURIComponent(
  `Olá,\n\nAssine comigo a petição pela sanção integral do PLV nº 12/2026 (leva cerca de 1 minuto).\n\nO que pedimos:\n${POINTS.map((p) => "• " + p).join("\n")}\n\nAssine por aqui: ${INVITE}\nCartaz da campanha: ${DOWNLOAD}\n\n${HASHTAGS.join(" ")}\n\nIniciativa da ADUNIR – Seção Sindical do ANDES-SN.`)}`;

const icon = (k: string, w = 20) => `<img src="./icones/${k}.png" width="${w}" height="${w}" alt="" style="display:block;border:0;width:${w}px;height:${w}px;">`;
const card = (w: number, radius = 10) => `<img src="./cartao-exemplo.png" width="${w}" alt="Cartaz da campanha com o seu QR Code" style="display:block;width:${w}px;max-width:100%;height:auto;border:0;border-radius:${radius}px;">`;

/** Botão de rede: faixa colorida com o ícone e o nome. */
const netBtn = (r: Rede, o: { w?: string; label?: string; pad?: string } = {}) => `<table role="presentation" cellpadding="0" cellspacing="0" ${o.w ? `width="${o.w}"` : ""} style="${o.w ? "width:" + o.w + ";" : ""}"><tr><td bgcolor="${NET[r].cor}" style="border-radius:9px;"><a href="${shareHref(r)}" style="display:block;text-decoration:none;color:#fff;font-weight:700;font-size:14px;padding:${o.pad ?? "11px 14px"};border-radius:9px;background:${NET[r].cor};"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="padding-right:8px;">${icon(NET[r].ic)}</td><td style="color:#fff;font-weight:700;font-size:14px;">${o.label ?? NET[r].nome}</td></tr></table></a></td></tr></table>`;
const dlBtn = (full = false) => `<table role="presentation" cellpadding="0" cellspacing="0" ${full ? 'width="100%"' : ""}><tr><td align="center" bgcolor="${BRAND}" style="border-radius:10px;"><a href="${DOWNLOAD}" style="display:block;padding:14px 22px;font-size:16px;font-weight:800;color:#fff;text-decoration:none;border-radius:10px;background:${BRAND};"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td style="padding-right:9px;">${icon("dl", 22)}</td><td style="color:#fff;font-size:16px;font-weight:800;">Baixar o cartaz da campanha</td></tr></table></a></td></tr></table>`;
const fwdBtn = (full = false, dark = false) => `<table role="presentation" cellpadding="0" cellspacing="0" ${full ? 'width="100%"' : ""}><tr><td align="center" style="border:2px solid ${dark ? "#fff" : BRAND};border-radius:10px;"><a href="${FORWARD}" style="display:block;padding:11px 18px;font-size:15px;font-weight:800;color:${dark ? "#fff" : BRAND};text-decoration:none;">&#9993;&nbsp; Reencaminhar para um contato</a></td></tr></table>`;
const tags = (dark = false) => HASHTAGS.map((h) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 9px;border-radius:99px;font-size:12px;font-weight:700;background:${dark ? YELLOW : SOFT};color:${dark ? GREEN : BRAND};">${h}</span>`).join("");
const msgText = (dark = false) => `<div style="font-size:13.5px;line-height:1.5;color:${dark ? "#fff" : "#2b3d35"};">Assine pela <strong>sanção integral do PLV nº 12/2026</strong>! Educação federal pública na Amazônia Legal e na Faixa de Fronteira.<br><span style="color:${dark ? YELLOW : BRAND};font-weight:700;">${HASHTAGS.join(" ")}</span><br>${INVITE.replace("https://", "")}</div>`;
const pointsList = (color = "#1b2b24", dot = BRAND, size = 13.5) => `<table role="presentation" cellpadding="0" cellspacing="0">${POINTS.map((p, i) => `<tr><td valign="top" style="padding:0 9px 6px 0;font-size:${size}px;font-weight:800;color:${dot};">${i + 1}.</td><td style="padding:0 0 6px;font-size:${size}px;line-height:1.4;color:${color};">${esc(p)}</td></tr>`).join("")}</table>`;
const hdr = `<p style="margin:0 0 12px;">Olá, <strong>${esc(firstName)}</strong>.</p>
<p style="margin:0 0 6px;">Sua assinatura foi confirmada em 03/11/2026 às 15:58. <strong>Obrigado!</strong></p>
<p style="margin:0;">Agora ajude a petição a crescer: baixe o cartaz da campanha e compartilhe. O QR Code do cartaz é só seu, e o cartaz não leva o seu nome.</p>`;
const foot = `<p style="margin:16px 0 0;font-size:13px;color:${MUTED};">Guarde este e-mail: o seu link pessoal (<a href="${PANEL}" style="color:${BRAND};">abrir meu painel</a>) é a única forma de recuperar o seu painel e ver quantos colegas assinaram por você.</p>`;
const wrap = (inner: string) => layout({ origin: ".", title: "Assinatura confirmada", preheader: `Obrigado, ${firstName}! Baixe o cartaz e compartilhe a petição.`, body: hdr + inner + foot });
const row = (cells: string[], gap = 8) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${cells.map((c, i) => `<td valign="top" width="${Math.floor(100 / cells.length)}%" style="padding:0 ${i < cells.length - 1 ? gap : 0}px 0 0;">${c}</td>`).join("")}</tr></table>`;

// 1) Cartaz grande no topo + botões em grade
const L1 = wrap(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr><td align="center">
  <div style="width:330px;max-width:100%;border:1px solid ${LINE};border-radius:12px;padding:8px;background:#fff;">${card(312)}</div></td></tr>
  <tr><td align="center" style="padding:16px 0 4px;">${dlBtn()}</td></tr>
  <tr><td style="padding:18px 0 6px;"><div style="font-size:12px;font-weight:800;color:${GREEN};text-transform:uppercase;letter-spacing:.07em;margin-bottom:10px;">Compartilhar o cartaz com o texto</div>
    ${row([netBtn("whatsapp", { w: "100%" }), netBtn("telegram", { w: "100%" })])}<div style="height:8px;line-height:8px;">&nbsp;</div>${row([netBtn("x", { w: "100%" }), netBtn("facebook", { w: "100%" })])}<div style="height:8px;line-height:8px;">&nbsp;</div>${netBtn("instagram", { w: "100%" })}</td></tr>
  <tr><td style="padding:10px 0 0;"><div style="background:${SOFT};border-radius:10px;padding:12px 14px;"><div style="font-size:11px;font-weight:800;color:${BRAND};text-transform:uppercase;letter-spacing:.07em;margin-bottom:6px;">Mensagem que vai junto</div>${msgText()}</div></td></tr>
  <tr><td style="padding:14px 0 0;">${fwdBtn(true)}</td></tr></table>`);

// 2) Passo a passo 1-2-3
const step = (n: number, t: string, inner: string) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 14px;"><tr><td valign="top" width="40" style="padding-top:2px;"><div style="width:30px;height:30px;line-height:30px;border-radius:50%;background:${BRAND};color:#fff;font-weight:800;text-align:center;font-size:15px;">${n}</div></td><td><div style="font-size:15px;font-weight:800;color:${GREEN};margin-bottom:8px;">${t}</div>${inner}</td></tr></table>`;
const L2 = wrap(`<div style="margin:22px 0 0;">
  ${step(1, "Baixe o cartaz", `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td valign="top" style="padding-right:14px;width:130px;">${card(124, 8)}</td><td valign="middle"><div style="font-size:13px;line-height:1.5;color:#2b3d35;margin-bottom:10px;">Com o seu QR Code pessoal e os 5 pedidos da campanha.</div>${dlBtn()}</td></tr></table>`)}
  ${step(2, "Compartilhe com o texto e o cartaz", `<div style="margin-bottom:10px;">${msgText()}</div>${row([netBtn("whatsapp", { w: "100%", pad: "10px 12px" }), netBtn("telegram", { w: "100%", pad: "10px 12px" })], 6)}<div style="height:6px;line-height:6px;">&nbsp;</div>${row([netBtn("x", { w: "100%", pad: "10px 12px" }), netBtn("facebook", { w: "100%", pad: "10px 12px" }), netBtn("instagram", { w: "100%", pad: "10px 12px" })], 6)}`)}
  ${step(3, "Ou reencaminhe a um contato", `<div style="font-size:13px;line-height:1.5;color:#2b3d35;margin-bottom:10px;">Abre o seu e-mail com o texto da campanha, os principais pontos e o link do cartaz; você escolhe quem recebe.</div>${fwdBtn()}`)}</div>`);

// 3) Painel verde (como o cartaz): cartaz + botões claros
const wBtn = (r: Rede) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td bgcolor="#ffffff" style="border-radius:9px;"><a href="${shareHref(r)}" style="display:block;text-decoration:none;color:${GREEN};font-weight:800;font-size:14px;padding:10px 12px;border-radius:9px;background:#fff;"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:9px;"><div style="width:26px;height:26px;border-radius:50%;background:${NET[r].cor};"><table role="presentation" cellpadding="0" cellspacing="0" width="26" height="26"><tr><td align="center" valign="middle">${icon(NET[r].ic, 15)}</td></tr></table></div></td><td style="color:${GREEN};font-weight:800;font-size:14px;">${NET[r].nome}</td></tr></table></a></td></tr></table>`;
const L3 = wrap(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;background:${GREEN};border-radius:14px;"><tr>
  <td valign="top" width="210" style="padding:18px 10px 18px 18px;">${card(190, 8)}</td>
  <td valign="top" style="padding:18px 18px 8px 8px;"><div style="font-size:11px;letter-spacing:.12em;font-weight:800;color:${YELLOW};text-transform:uppercase;">Seu cartaz da campanha</div>
    <div style="font-size:18px;line-height:1.25;font-weight:800;color:#fff;margin:5px 0 8px;">Compartilhe e convide colegas</div>${msgText(true)}<div style="margin-top:10px;">${tags(true)}</div></td></tr>
  <tr><td colspan="2" style="padding:6px 18px 6px;">${dlBtn(true)}</td></tr>
  <tr><td colspan="2" style="padding:8px 18px 4px;"><div style="font-size:12px;font-weight:800;color:${YELLOW};text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Enviar com o cartaz</div>
    ${row([wBtn("whatsapp"), wBtn("telegram")], 8)}<div style="height:8px;line-height:8px;">&nbsp;</div>${row([wBtn("x"), wBtn("facebook"), wBtn("instagram")], 8)}</td></tr>
  <tr><td colspan="2" style="padding:12px 18px 18px;">${fwdBtn(true, true)}</td></tr></table>`);

// 4) Ícones redondos em linha + cartaz e texto lado a lado
const circ = (r: Rede) => `<table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td align="center"><a href="${shareHref(r)}" style="text-decoration:none;display:block;"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td width="52" height="52" align="center" valign="middle" bgcolor="${NET[r].cor}" style="border-radius:26px;">${icon(NET[r].ic, 26)}</td></tr></table><div style="font-size:11.5px;font-weight:700;color:#2b3d35;margin-top:5px;text-align:center;">${NET[r].nome.replace(" (Twitter)", "")}</div></a></td></tr></table>`;
const L4 = wrap(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border:1px solid ${LINE};border-radius:14px;"><tr>
  <td valign="top" width="200" style="padding:16px 8px 12px 16px;">${card(184, 8)}</td>
  <td valign="top" style="padding:16px 16px 12px 8px;"><div style="font-size:11px;letter-spacing:.1em;font-weight:800;color:${BRAND};text-transform:uppercase;">Mensagem pronta</div><div style="margin:6px 0 8px;">${msgText()}</div>${tags()}</td></tr>
  <tr><td colspan="2" style="padding:4px 16px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${REDES.map((r) => `<td align="center" width="20%">${circ(r)}</td>`).join("")}</tr></table></td></tr>
  <tr><td colspan="2" style="padding:0 16px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td width="52%" style="padding-right:6px;">${dlBtn(true)}</td><td width="48%" style="padding-left:6px;">${fwdBtn(true)}</td></tr></table></td></tr></table>`);

// 5) Bolha de conversa + lista de botões em largura total
const L5 = wrap(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;"><tr>
  <td valign="top" width="52%" style="padding-right:12px;"><div style="border:1px solid ${LINE};border-radius:12px;padding:8px;background:#fff;">${card(244, 8)}</div><div style="padding-top:10px;">${dlBtn(true)}</div></td>
  <td valign="top" style="padding-left:0;"><div style="font-size:11px;font-weight:800;color:${BRAND};text-transform:uppercase;letter-spacing:.07em;margin-bottom:8px;">Como a mensagem vai chegar</div>
    <div style="background:#dcf8c6;border-radius:12px 12px 12px 2px;padding:10px 12px;"><div style="margin:0 0 6px;font-size:11px;color:#4a5b53;">&#128206; cartaz-plv12.png</div>${msgText()}</div>
    <div style="padding-top:10px;">${tags()}</div></td></tr></table>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:14px 0 0;">${REDES.map((r) => `<tr><td style="padding:0 0 7px;">${netBtn(r, { w: "100%", label: `Compartilhar no ${NET[r].nome.replace(" (Twitter)", "")}` })}</td></tr>`).join("")}<tr><td style="padding:4px 0 0;">${fwdBtn(true)}</td></tr></table>`);

const nomes = ["Cartaz grande no topo, botões em grade", "Passo a passo 1-2-3", "Painel verde (igual ao cartaz)", "Ícones redondos em linha", "Bolha de conversa e lista de botões"];
[L1, L2, L3, L4, L5].forEach((h, i) => writeFileSync(join(OUT, `layout-${i + 1}.html`), h));
writeFileSync(join(OUT, "index.html"), `<!doctype html><meta charset="utf-8"><title>Layouts do e-mail pós-confirmação</title><body style="font-family:system-ui;max-width:900px;margin:24px auto;padding:0 16px"><h1>5 propostas: e-mail enviado depois de confirmar a assinatura</h1><p>Exemplo com o nome “Maria” e código ${CODE}. Nada disto foi publicado. Os botões apontam para os endereços previstos no site (ainda não existem).</p><ol>${nomes.map((n, i) => `<li><a href="layout-${i + 1}.html">Layout ${i + 1}: ${n}</a> · <a href="layout-${i + 1}.png">imagem</a></li>`).join("")}</ol></body>`);
console.log("ok", OUT);
