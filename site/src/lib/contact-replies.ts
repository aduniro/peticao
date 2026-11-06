import { audit, query, tx } from "./db";
import type { PoolClient } from "pg";
import { config } from "./config";
import { hmac, safeEqual } from "./security";
import { sendMail } from "./mail";
import { dispatchContactReply, type ContactDeliveryState } from "./contact-delivery";
import { respostaContatoHtml, respostaContatoTexto } from "./mail/templates";
import { HASHTAGS, campaignMessage } from "../content/compartilhar";
import { GOV_POINTS } from "../content/governo";

/**
 * Resposta do painel a uma mensagem de contato. Cada caso sai em DOIS e-mails (regra aprovada pela ADUNIR):
 *  1) só texto, no primeiro modelo (assinatura "ADUNIR · ANDES-SN"), enviado na hora;
 *  2) o e-mail com o card de divulgação (cartaz com o QR pessoal), agendado para ~1 minuto depois pela fila durável (sobrevive a reinício);
 *     só existe se quem escreveu tem cadastro com código pessoal de divulgação.
 * Cada versão tem uma reserva durável e no máximo uma tentativa automática; resultado incerto não é repetido; para responder de novo é preciso pedir uma nova rodada de propósito.
 */
export const ASSUNTO_CARD = "Divulgue a petição: seu cartaz com QR Code pessoal";
export const ASSINATURA_TEXTO = "ADUNIR · ANDES-SN\nPetição pela sanção integral do PLV nº 12/2026";

export type Entrada = { assunto: string; corpo: string };
export type Previa = { para: string; primeiroNome: string; codigoPessoal: string | null; texto: { assunto: string; texto: string }; card: { assunto: string; html: string; texto: string } | null; selo: string };

const limpar = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\r/g, "").trim().slice(0, max) : "");
export function validarEntrada(e: unknown): { ok: true; v: Entrada } | { ok: false; erro: "assunto" | "corpo" } {
  const x = (e ?? {}) as Record<string, unknown>;
  const assunto = limpar(x.assunto, 150).replace(/\s+/g, " "), corpo = limpar(x.corpo, 5000);
  if (assunto.length < 3) return { ok: false, erro: "assunto" };
  if (corpo.length < 10) return { ok: false, erro: "corpo" };
  return { ok: true, v: { assunto, corpo } };
}
const paragrafos = (corpo: string) => corpo.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

/** Código pessoal de divulgação de quem escreveu (cadastro com o mesmo e-mail), ou null. */
export async function codigoPessoalPorEmail(email: string, client?: PoolClient): Promise<string | null> {
  const r = await query<{ code: string }>("SELECT r.code FROM referrers r JOIN signatures s ON s.id=r.signature_id WHERE lower(s.email)=lower($1) ORDER BY r.id LIMIT 1", [email], client);
  return r.rows[0]?.code ?? null;
}

const proximaRodada = async (contactId: number, client?: PoolClient) => ((await query<{ m: number | null }>("SELECT MAX(rodada)::int m FROM contact_replies WHERE contact_id=$1", [contactId], client)).rows[0].m ?? 0);

/** Monta os dois e-mails SEM enviar nada. O `selo` amarra a prévia ao texto exato: o envio só vale com o selo da prévia vista. */
export async function montarPrevia(contactId: number, entrada: Entrada, rodada: number, origin = config.appUrl(), client?: PoolClient): Promise<Previa | null> {
  const c = (await query<{ name: string; email: string }>("SELECT name, email FROM contact_messages WHERE id=$1", [contactId], client)).rows[0];
  if (!c) return null;
  const org = origin.replace(/\/$/, "");
  const primeiroNome = c.name.trim().split(/\s+/)[0];
  const codigo = await codigoPessoalPorEmail(c.email, client);
  const pars = paragrafos(entrada.corpo);
  const texto = `Olá, ${primeiroNome},\n\n${pars.join("\n\n")}\n\nUm abraço,\n${ASSINATURA_TEXTO}`;
  let card: Previa["card"] = null;
  if (codigo) {
    const invite = `${org}/r/${codigo}`, message = campaignMessage(invite);
    const forwardHref = `mailto:?subject=${encodeURIComponent("Assine: sanção integral do PLV 12/2026")}&body=${encodeURIComponent(`Olá,\n\nAssine comigo a petição pela sanção integral do PLV nº 12/2026 (leva cerca de 1 minuto).\n\nO que pedimos:\n${GOV_POINTS.map((p) => "• " + p).join("\n")}\n\nAssine por aqui: ${invite}\nCartaz da campanha: ${org}/api/cartaz/${codigo}?baixar=1\n\n${HASHTAGS.join(" ")}\n\nIniciativa da ADUNIR – Seção Sindical do ANDES-SN.`)}`;
    card = {
      assunto: ASSUNTO_CARD,
      html: respostaContatoHtml({ origin: org, firstName: primeiroNome, paragraphs: pars, card: { code: codigo, message, hashtags: HASHTAGS, forwardHref } }),
      texto: respostaContatoTexto({ origin: org, firstName: primeiroNome, paragraphs: pars, card: { code: codigo, message } }),
    };
  }
  const selo = hmac(`resposta-v2:${contactId}:${rodada}:` + JSON.stringify({ origin: org, para: c.email, primeiroNome, codigo, texto, card, assunto: entrada.assunto, bcc: config.contactBcc(), replyTo: config.mailReplyTo() || config.contactBcc()[0] })).slice(0, 32);
  return { para: c.email, primeiroNome, codigoPessoal: codigo, texto: { assunto: entrada.assunto, texto }, card, selo };
}

export type Envio = { ok: true; texto: "enviado" | "na-fila"; card: "agendado" | "sem-codigo"; rodada: number } | { ok: false; erro: "nao_existe" | "assunto" | "corpo" | "ja_respondida" | "selo" | "falhou" | "envio_inconclusivo"; detalhe?: string };

/** Reserves the exact approved messages together before any external side effect. */
export async function enviarResposta(o: { contactId: number; entrada: unknown; selo: string; nova?: boolean; por: { userId: number; email: string }; origin?: string; enviar?: typeof sendMail; deadlineMs?: number }): Promise<Envio> {
  const v = validarEntrada(o.entrada);
  if (!v.ok) return { ok: false, erro: v.erro };
  const reserved = await tx(async c => {
    const contact = (await c.query("SELECT id FROM contact_messages WHERE id=$1 FOR UPDATE", [o.contactId])).rows[0];
    if (!contact) return { erro: "nao_existe" as const };
    const last = await proximaRodada(o.contactId, c);
    if (last > 0 && !o.nova) {
      const previous = (await c.query<{ estado: ContactDeliveryState; ok: boolean }>("SELECT estado,ok FROM contact_replies WHERE contact_id=$1 AND rodada=$2 AND versao='texto'", [o.contactId, last])).rows[0];
      return { erro: previous && (previous.estado === "accepted" || previous.estado === "legacy" && previous.ok) ? "ja_respondida" as const : "envio_inconclusivo" as const };
    }
    const rodada = last + 1;
    const preview = await montarPrevia(o.contactId, v.v, rodada, o.origin, c);
    if (!preview) return { erro: "nao_existe" as const };
    if (!safeEqual(preview.selo, o.selo)) return { erro: "selo" as const };
    const copies = { to: preview.para, bcc: config.contactBcc(), replyTo: config.mailReplyTo() || config.contactBcc()[0] };
    const text = (await c.query<{ id: number }>(`INSERT INTO contact_replies(contact_id,rodada,versao,user_id,por,assunto,codigo_pessoal,estado,payload,selo,due_at)
      VALUES($1,$2,'texto',$3,$4,$5,$6,'prepared',$7,$8,now()) RETURNING id`, [o.contactId, rodada, o.por.userId || null, o.por.email, preview.texto.assunto, preview.codigoPessoal, JSON.stringify({ ...copies, subject: preview.texto.assunto, text: preview.texto.texto }), preview.selo])).rows[0].id;
    if (preview.card) {
      await c.query(`INSERT INTO contact_replies(contact_id,rodada,versao,user_id,por,assunto,codigo_pessoal,agendada,estado,payload,selo)
        VALUES($1,$2,'card',$3,$4,$5,$6,true,'blocked',$7,$8)`, [o.contactId, rodada, o.por.userId || null, o.por.email, preview.card.assunto, preview.codigoPessoal, JSON.stringify({ ...copies, subject: preview.card.assunto, text: preview.card.texto, html: preview.card.html }), preview.selo]);
    }
    await audit("contato_resposta_reservada", null, { contato: o.contactId, rodada, por: o.por.email, texto: text, card: !!preview.card, selo: preview.selo }, c);
    return { text, rodada, card: !!preview.card };
  });
  if ("erro" in reserved) return { ok: false, erro: reserved.erro! };
  let result;
  try { result = await dispatchContactReply(reserved.text, { enviar: o.enviar, deadlineMs: o.deadlineMs }); }
  catch { return { ok: false, erro: "envio_inconclusivo" }; }
  if (result.estado === "accepted") return { ok: true, texto: "enviado", card: reserved.card ? "agendado" : "sem-codigo", rodada: reserved.rodada };
  return { ok: false, erro: result.estado === "rejected" ? "falhou" : "envio_inconclusivo" };
}

export type Historico = { id: number; rodada: number; versao: string; por: string | null; assunto: string; ok: boolean; erro: string | null; agendada: boolean; criada_em: string; estado: ContactDeliveryState; error_code: string | null; due_at: string | null; finished_at: string | null };
export const historicoDeRespostas = async (ids: number[]): Promise<Record<number, Historico[]>> => {
  if (!ids.length) return {};
  const r = await query<Historico & { contact_id: number }>("SELECT id, contact_id, rodada, versao, por, assunto, ok, erro, agendada, criada_em, estado, error_code, due_at, finished_at FROM contact_replies WHERE contact_id = ANY($1::int[]) ORDER BY id", [ids]);
  const m: Record<number, Historico[]> = {};
  for (const x of r.rows) (m[x.contact_id] ??= []).push(x);
  return m;
};

/** Situação do cadastro de quem escreveu (para mostrar ao lado da mensagem). */
export async function situacaoDoCadastro(email: string): Promise<{ status: string; confirmada_em: string | null } | null> {
  const r = await query<{ status: string; confirmed_at: string | null }>("SELECT status, confirmed_at FROM signatures WHERE lower(email)=lower($1) ORDER BY id DESC LIMIT 1", [email]);
  return r.rows[0] ? { status: r.rows[0].status, confirmada_em: r.rows[0].confirmed_at } : null;
}
