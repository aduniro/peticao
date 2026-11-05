import type { ConfirmFull } from "@/lib/signatures";
import { tick } from "@/lib/batches";
import { recordEvent, optedOut } from "@/lib/track";
import { sendMail } from "@/lib/mail";
import { logRequest } from "@/lib/abuse";
import { confirmedHtml, shareCampaignHtml } from "@/lib/mail/templates";
import { query } from "@/lib/db";
import { institutionLabel } from "@/lib/ifes-data";
import { statementLine } from "@/lib/signature-text";
import { formatCode } from "@/lib/verify-code";
import { countryName } from "@/i18n";
import { GOV_POINTS } from "@/content/governo";
import { HASHTAGS, campaignMessage } from "@/content/compartilhar";
import { config } from "@/lib/config";
import { notificarConfirmacaoWhatsapp } from "@/lib/whatsapp/store";

/**
 * Tudo o que acontece DEPOIS de uma confirmação, por qualquer canal (link do e-mail ou do WhatsApp): registro, fechamento de lote, e-mails de
 * agradecimento e de divulgação e o aviso padrão por WhatsApp (se a pessoa informou número). A data/hora da assinatura é sempre a original do banco.
 */
export async function posConfirmacao(r: ConfirmFull, a: { ip: string; headers: Headers; canal: "email" | "whatsapp" }): Promise<void> {
  await logRequest("sign_confirmed", a.ip, { signatureId: r.signatureId, email: r.email, detail: a.canal === "whatsapp" ? "confirmada pelo WhatsApp" : "e-mail confirmado" });
  if (r.visitorId && !optedOut(a.headers)) {
    await recordEvent({ visitorId: r.visitorId, type: "confirmed", path: a.canal === "whatsapp" ? "/confirmar/whatsapp" : "/confirmar", ip: a.ip, ua: a.headers.get("user-agent") ?? "" }).catch(() => {});
  }
  await tick().catch((e) => console.error("tick falhou", e)); // fecha lote se atingiu a meta
  const origin = config.appUrl().replace(/\/$/, "");
  const panel = r.manageToken ? `${origin}/meu/${r.manageToken}` : null;
  if (r.email) {
    // Dois e-mails depois da confirmação. A data e a hora da assinatura são SEMPRE as originais gravadas no banco (confirmed_at), nunca a hora do envio.
    const sig = (await query<{ seq: number | null; verify_code: string | null; confirmed_at: string; category: string; institution: string | null; city: string | null; uf: string | null; university: string | null; country: string | null; cpf_name_check: string | null }>(
      "SELECT seq, verify_code, confirmed_at, category, institution, city, uf, university, country, cpf_name_check FROM signatures WHERE id=$1", [r.signatureId]).catch(() => ({ rows: [] }))).rows[0];
    const first = (r.name ?? "").split(" ")[0];
    if (sig?.verify_code) {
      const who = sig.category === "servidor" ? institutionLabel(sig.institution) : sig.category === "estrangeiro" ? [sig.university, sig.country ? `(${countryName(sig.country, "pt")})` : ""].filter(Boolean).join(" ") : [sig.city, sig.uf].filter(Boolean).join("/");
      const statement = statementLine({ category: sig.category, cpf_name_check: sig.cpf_name_check, confirmed_at: sig.confirmed_at });
      const verifyUrl = `${origin}/verificar/${sig.verify_code}`;
      await sendMail({
        to: r.email,
        subject: "Assinatura confirmada: obrigado por participar!",
        html: confirmedHtml({ origin, firstName: first, name: r.name ?? "", institution: who, statement, code: formatCode(sig.verify_code), seq: sig.seq, verifyUrl, qrUrl: `${origin}/api/qr/${sig.verify_code}.png` }),
        text: `Olá, ${first}.\n\nObrigado por participar! Sua assinatura na petição pela sanção integral do PLV nº 12/2026 foi confirmada.\n\n${sig.seq ? `Nº ${sig.seq}  ·  ` : ""}${r.name}${who ? `\n${who}` : ""}\n${statement}\nCódigo de verificação: ${formatCode(sig.verify_code)}\n\nPara verificar que a sua assinatura está confirmada e validada, abra:\n${verifyUrl}\n\nEm outro e-mail você recebe o cartaz da campanha para divulgar.\n\nADUNIR – Seção Sindical do ANDES-SN`,
      }, "confirmada").catch(() => {});
    }
    if (panel && r.code) {
      const invite = `${origin}/r/${r.code}`;
      const message = campaignMessage(invite);
      const forwardHref = `mailto:?subject=${encodeURIComponent("Assine: sanção integral do PLV 12/2026")}&body=${encodeURIComponent(`Olá,\n\nAssine comigo a petição pela sanção integral do PLV nº 12/2026 (leva cerca de 1 minuto).\n\nO que pedimos:\n${GOV_POINTS.map((p) => "• " + p).join("\n")}\n\nAssine por aqui: ${invite}\nCartaz da campanha: ${origin}/api/cartaz/${r.code}?baixar=1\n\n${HASHTAGS.join(" ")}\n\nIniciativa da ADUNIR – Seção Sindical do ANDES-SN.`)}`;
      await sendMail({
        to: r.email,
        subject: "Divulgue a petição: seu cartaz com QR Code pessoal",
        html: shareCampaignHtml({ origin, firstName: first, code: r.code, panel, message, hashtags: HASHTAGS, points: GOV_POINTS, forwardHref }),
        text: `Olá, ${first}.\n\nAjude a petição a crescer: baixe o cartaz da campanha e compartilhe com colegas, amigos e familiares. O QR Code do cartaz é só seu e o cartaz não leva o seu nome.\n\nBaixar o cartaz: ${origin}/api/cartaz/${r.code}?baixar=1\nCompartilhar no WhatsApp: ${origin}/c/${r.code}?r=whatsapp\nTelegram: ${origin}/c/${r.code}?r=telegram\nX: ${origin}/c/${r.code}?r=x\nFacebook: ${origin}/c/${r.code}?r=facebook\nInstagram: ${origin}/c/${r.code}?r=instagram\n\nMensagem pronta:\n${message}\n\nO seu painel pessoal (guarde este e-mail, é a única forma de recuperá-lo): ${panel}\n\nADUNIR – Seção Sindical do ANDES-SN`,
      }, "divulgacao").catch(() => {});
    }
  }
  await notificarConfirmacaoWhatsapp(r.signatureId!).catch((e) => console.error("whatsapp: aviso falhou", e instanceof Error ? e.message : e));
}
