/** Modelos de e-mail em HTML (tabelas e CSS inline, que todos os leitores aceitam). O texto puro continua sendo enviado junto, como alternativa. */
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const GREEN = "#05382a", BRAND = "#0b6b45", YELLOW = "#f5c518", MUTED = "#5b6b63";

export function layout(o: { origin: string; preheader: string; title: string; body: string }): string {
  const origin = o.origin.replace(/\/$/, "");
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${esc(o.title)}</title></head>
<body style="margin:0;padding:0;background:#eef3f0;font-family:Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1b2b24;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(o.preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3f0;padding:24px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #d5e0da;">
  <tr><td style="background:${GREEN};padding:20px 28px 16px;">
    <div style="font-size:11px;letter-spacing:.12em;font-weight:700;color:${YELLOW};text-transform:uppercase;">Petição pública</div>
    <div style="font-size:21px;line-height:1.25;font-weight:800;color:#ffffff;margin-top:6px;">Sancione o PLV 12/2026</div>
  </td></tr>
  <tr><td style="height:4px;background:${YELLOW};line-height:4px;font-size:0;">&nbsp;</td></tr>
  <tr><td style="padding:26px 28px 8px;font-size:16px;line-height:1.55;">${o.body}</td></tr>
  <tr><td style="padding:8px 28px 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #d5e0da;border-radius:10px;"><tr><td align="center" style="padding:14px 10px 10px;">
      <div style="font-size:12px;font-weight:700;color:#05382a;margin:0 0 10px;">Iniciativa da ADUNIR – Seção Sindical do ANDES-SN</div>
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="padding:0 14px 0 0;border-right:1px solid #d5e0da;"><img src="${origin}/logos/adunir.png" width="150" alt="ADUNIR" style="display:block;width:150px;height:auto;border:0;"></td>
        <td style="padding:0 0 0 14px;"><img src="${origin}/logos/andes.png" width="62" alt="ANDES-SN" style="display:block;width:62px;height:auto;border:0;"></td>
      </tr></table>
    </td></tr></table>
    <p style="margin:12px 0 0;font-size:12px;line-height:1.5;color:#5b6b63;text-align:center;">ADUNIR – Seção Sindical do ANDES-SN (CNPJ 15.883.671/0001-15).<br>
      <a href="${origin}/privacidade" style="color:${BRAND};">Privacidade</a> · <a href="${origin}/contato" style="color:${BRAND};">Contato</a> · <a href="${origin}/verificar" style="color:${BRAND};">Verificar assinatura</a></p>
  </td></tr>
</table></td></tr></table></body></html>`;
}

export const button = (href: string, label: string) =>
  `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto;"><tr><td align="center" bgcolor="${BRAND}" style="border-radius:10px;">
    <a href="${esc(href)}" style="display:inline-block;padding:15px 30px;font-size:17px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px;background:${BRAND};">${esc(label)}</a>
  </td></tr></table>`;

/** E-mail de confirmação: botão grande com o link específico desta assinatura. */
export function confirmationHtml(o: { origin: string; firstName: string; link: string; hours: number; startedAt: string }): string {
  return layout({
    origin: o.origin, title: "Confirme sua assinatura", preheader: `${o.firstName}, falta só um clique para confirmar a sua assinatura.`,
    body: `<p style="margin:0 0 12px;">Olá, <strong>${esc(o.firstName)}</strong>.</p>
<p style="margin:0 0 6px;">Você iniciou a sua assinatura na petição pela <strong>sanção integral do PLV nº 12/2026</strong> em ${esc(o.startedAt)}.</p>
<p style="margin:0;">Para que ela conte, confirme o seu e-mail:</p>
${button(o.link, "Confirmar minha assinatura")}
<p style="margin:0 0 8px;font-size:13px;color:#5b6b63;">Se o botão não abrir, copie e cole este endereço no navegador:<br><a href="${esc(o.link)}" style="color:${BRAND};word-break:break-all;">${esc(o.link)}</a></p>
<p style="margin:14px 0 0;font-size:13px;color:#5b6b63;">O link vale por ${o.hours} horas e só pode ser usado uma vez. Se não foi você, ignore esta mensagem: nada será registrado.</p>`,
  });
}

// ---------- E-mails depois da confirmação ----------
const NET_ICON: Record<string, { cor: string; nome: string; ic: string }> = {
  whatsapp: { cor: "#25D366", nome: "WhatsApp", ic: "wa" }, telegram: { cor: "#229ED9", nome: "Telegram", ic: "tg" }, x: { cor: "#000000", nome: "X", ic: "x" },
  facebook: { cor: "#1877F2", nome: "Facebook", ic: "fb" }, instagram: { cor: "#C13584", nome: "Instagram", ic: "ig" },
};

/** 1) Agradecimento + confirmação: o cartão da assinatura (o mesmo bloco do PDF: QR, nome, instituição, frase com a data/hora ORIGINAL, código) e o link de verificação. */
export function confirmedHtml(o: { origin: string; firstName: string; name: string; institution: string; statement: string; code: string; seq: number | null; verifyUrl: string; qrUrl: string }): string {
  const verified = /verifica[çc][ãa]o de autenticidade/.test(o.statement);
  return layout({
    origin: o.origin, title: "Assinatura confirmada", preheader: `Obrigado, ${o.firstName}! Sua assinatura foi confirmada e validada.`,
    body: `<p style="margin:0 0 12px;">Olá, <strong>${esc(o.firstName)}</strong>.</p>
<p style="margin:0 0 6px;"><strong>Obrigado por participar!</strong> Sua assinatura na petição pela <strong>sanção integral do PLV nº 12/2026</strong> foi confirmada.</p>
<p style="margin:0 0 4px;">Este é o seu cartão de assinatura, igual ao que aparece na lista em PDF:</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0 4px;border:1px solid #d5e0da;border-radius:10px;background:#ffffff;"><tr>
  <td width="6" bgcolor="${verified ? BRAND : "#d5e0da"}" style="border-radius:10px 0 0 10px;font-size:0;line-height:0;">&nbsp;</td>
  <td width="104" valign="middle" style="padding:14px 8px 14px 14px;"><img src="${esc(o.qrUrl)}" width="88" height="88" alt="QR Code de verificação" style="display:block;width:88px;height:88px;border:0;"></td>
  <td valign="top" style="padding:12px 16px 12px 6px;">
    <div style="font-size:11px;color:#5b6b63;">${o.seq ? `Nº ${o.seq}` : ""}<span style="float:right;">código ${esc(o.code)}</span></div>
    <div style="font-size:18px;line-height:1.25;font-weight:800;color:${GREEN};margin:4px 0 3px;">${esc(o.name)}</div>
    ${o.institution ? `<div style="font-size:13px;color:#1b2b24;margin:0 0 6px;">${esc(o.institution)}</div>` : ""}
    <div style="font-size:11.5px;line-height:1.45;color:#5b6b63;">${esc(o.statement)}</div>
  </td></tr></table>
${button(o.verifyUrl, "Verificar minha assinatura")}
<p style="margin:0 0 4px;font-size:13px;color:#5b6b63;">Pelo botão (ou pelo QR Code) você abre a página pública que mostra que a sua assinatura está confirmada e validada. Ela exibe só o seu nome, a instituição e a data e hora; nunca o CPF nem o e-mail.<br><a href="${esc(o.verifyUrl)}" style="color:${BRAND};word-break:break-all;">${esc(o.verifyUrl)}</a></p>
<p style="margin:12px 0 0;font-size:13px;color:#5b6b63;">Em outro e-mail, a seguir, você recebe o cartaz da campanha para divulgar entre colegas, amigos e familiares.</p>`,
  });
}

/** 2) Divulgação (layout 4): cartaz pessoal sem nome, mensagem pronta com hashtags, ícones das redes, baixar e reencaminhar. */
export function shareCampaignHtml(o: { origin: string; firstName: string; code: string; panel: string; message: string; hashtags: readonly string[]; points: readonly string[]; forwardHref: string }): string {
  const origin = o.origin.replace(/\/$/, "");
  const cartaz = `${origin}/api/cartaz/${o.code}.png?w=540`;
  const download = `${origin}/api/cartaz/${o.code}?baixar=1`;
  const share = (r: string) => `${origin}/c/${o.code}?r=${r}`;
  const circ = (r: string) => `<td align="center" width="20%"><a href="${esc(share(r))}" style="text-decoration:none;display:block;"><table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td width="52" height="52" align="center" valign="middle" bgcolor="${NET_ICON[r].cor}" style="border-radius:26px;"><img src="${origin}/email-icones/${NET_ICON[r].ic}.png" width="26" height="26" alt="${NET_ICON[r].nome}" style="display:block;border:0;width:26px;height:26px;"></td></tr></table><div style="font-size:11.5px;font-weight:700;color:#2b3d35;margin-top:5px;text-align:center;">${NET_ICON[r].nome}</div></a></td>`;
  const tags = o.hashtags.map((h) => `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 9px;border-radius:99px;font-size:12px;font-weight:700;background:#eef6f1;color:${BRAND};">${esc(h)}</span>`).join("");
  const msg = esc(o.message).replace(/\n/g, "<br>");
  return layout({
    origin, title: "Divulgue a petição", preheader: `${o.firstName}, compartilhe o cartaz da campanha com o seu QR Code pessoal.`,
    body: `<p style="margin:0 0 12px;">Olá, <strong>${esc(o.firstName)}</strong>.</p>
<p style="margin:0;">Agora ajude a petição a crescer: baixe o cartaz da campanha e compartilhe com colegas de trabalho, amigos, familiares e outros interessados. O QR Code do cartaz é só seu, e o cartaz não leva o seu nome.</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:22px 0 0;border:1px solid #d5e0da;border-radius:14px;"><tr>
  <td valign="top" width="200" style="padding:16px 8px 12px 16px;"><a href="${esc(download)}"><img src="${esc(cartaz)}" width="184" alt="Cartaz da campanha com o seu QR Code" style="display:block;width:184px;max-width:100%;height:auto;border:0;border-radius:8px;"></a></td>
  <td valign="top" style="padding:16px 16px 12px 8px;"><div style="font-size:11px;letter-spacing:.1em;font-weight:800;color:${BRAND};text-transform:uppercase;">Mensagem pronta</div><div style="margin:6px 0 8px;font-size:13.5px;line-height:1.5;color:#2b3d35;">${msg}</div>${tags}</td></tr>
  <tr><td colspan="2" style="padding:4px 16px 14px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>${["whatsapp", "telegram", "x", "facebook", "instagram"].map(circ).join("")}</tr></table></td></tr>
  <tr><td colspan="2" style="padding:0 16px 16px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
    <td width="52%" style="padding-right:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="${BRAND}" style="border-radius:10px;"><a href="${esc(download)}" style="display:block;padding:14px 12px;font-size:15px;font-weight:800;color:#ffffff;text-decoration:none;border-radius:10px;background:${BRAND};">&#8681;&nbsp; Baixar o cartaz da campanha</a></td></tr></table></td>
    <td width="48%" style="padding-left:6px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="border:2px solid ${BRAND};border-radius:10px;"><a href="${esc(o.forwardHref)}" style="display:block;padding:11px 10px;font-size:14px;font-weight:800;color:${BRAND};text-decoration:none;">&#9993;&nbsp; Reencaminhar para um contato</a></td></tr></table></td></tr></table></td></tr></table>
<p style="margin:16px 0 0;font-size:13px;color:${MUTED};">Guarde este e-mail: o seu link pessoal (<a href="${esc(o.panel)}" style="color:${BRAND};">abrir meu painel</a>) é a única forma de recuperar o seu painel e ver quantos colegas assinaram por você.</p>`,
  });
}
