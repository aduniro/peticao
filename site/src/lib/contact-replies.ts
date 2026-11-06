import { query } from "./db";
import { config } from "./config";
import { hmac } from "./security";
import { sendMail } from "./mail";
import { enqueueMail } from "./mail/outbox";
import { respostaContatoHtml, respostaContatoTexto } from "./mail/templates";
import { HASHTAGS, campaignMessage } from "../content/compartilhar";
import { GOV_POINTS } from "../content/governo";

/**
 * Resposta do painel a uma mensagem de contato. Cada caso sai em DOIS e-mails (regra aprovada pela ADUNIR):
 *  1) só texto, no primeiro modelo (assinatura "ADUNIR · ANDES-SN"), enviado na hora;
 *  2) o e-mail com o card de divulgação (cartaz com o QR pessoal), agendado para ~1 minuto depois pela fila durável (sobrevive a reinício);
 *     só existe se quem escreveu tem cadastro com código pessoal de divulgação.
 * Nunca duplica: cada (mensagem, rodada, versão) só sai uma vez; para responder de novo é preciso pedir uma nova rodada de propósito.
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
export async function codigoPessoalPorEmail(email: string): Promise<string | null> {
  const r = await query<{ code: string }>("SELECT r.code FROM referrers r JOIN signatures s ON s.id=r.signature_id WHERE lower(s.email)=lower($1) ORDER BY r.id LIMIT 1", [email]);
  return r.rows[0]?.code ?? null;
}

const proximaRodada = async (contactId: number) => ((await query<{ m: number | null }>("SELECT MAX(rodada)::int m FROM contact_replies WHERE contact_id=$1", [contactId])).rows[0].m ?? 0);

/** Monta os dois e-mails SEM enviar nada. O `selo` amarra a prévia ao texto exato: o envio só vale com o selo da prévia vista. */
export async function montarPrevia(contactId: number, entrada: Entrada, rodada: number, origin = config.appUrl()): Promise<Previa | null> {
  const c = (await query<{ name: string; email: string }>("SELECT name, email FROM contact_messages WHERE id=$1", [contactId])).rows[0];
  if (!c) return null;
  const org = origin.replace(/\/$/, "");
  const primeiroNome = c.name.trim().split(/\s+/)[0];
  const codigo = await codigoPessoalPorEmail(c.email);
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
  const selo = hmac(`resposta:${contactId}:${rodada}:${entrada.assunto}:${entrada.corpo}:${codigo ?? "-"}`).slice(0, 32);
  return { para: c.email, primeiroNome, codigoPessoal: codigo, texto: { assunto: entrada.assunto, texto }, card, selo };
}

export type Envio = { ok: true; texto: "enviado" | "na-fila"; card: "agendado" | "sem-codigo"; rodada: number } | { ok: false; erro: "nao_existe" | "assunto" | "corpo" | "ja_respondida" | "selo" | "falhou"; detalhe?: string };

/**
 * Envia a resposta. `selo` = o da prévia (prova de que esse texto foi visto). `nova` = abrir outra rodada (resposta adicional); sem isso, uma mensagem que
 * já foi respondida é recusada. `enviar`/`agendar` injetáveis para teste.
 */
export async function enviarResposta(o: { contactId: number; entrada: unknown; selo: string; nova?: boolean; por: { userId: number; email: string }; origin?: string; enviar?: typeof sendMail; agendar?: typeof enqueueMail }): Promise<Envio> {
  const v = validarEntrada(o.entrada);
  if (!v.ok) return { ok: false, erro: v.erro };
  // Tentativa que falhou há mais de 2 minutos não bloqueia: pode tentar de novo (a reserva recente, ainda em andamento, continua valendo).
  await query("DELETE FROM contact_replies WHERE contact_id=$1 AND versao='texto' AND NOT ok AND criada_em < now() - interval '2 minutes'", [o.contactId]);
  const ultima = await proximaRodada(o.contactId);
  if (ultima > 0 && !o.nova) return { ok: false, erro: "ja_respondida" };
  const rodada = ultima + 1;
  const p = await montarPrevia(o.contactId, v.v, rodada, o.origin);
  if (!p) return { ok: false, erro: "nao_existe" };
  if (p.selo !== o.selo) return { ok: false, erro: "selo" };
  // Reserva a vaga ANTES de enviar: duas abas ou dois cliques não mandam duas vezes (a unicidade do banco decide).
  const reserva = await query("INSERT INTO contact_replies(contact_id,rodada,versao,user_id,por,assunto,codigo_pessoal) VALUES($1,$2,'texto',$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id", [o.contactId, rodada, o.por.userId || null, o.por.email, p.texto.assunto, p.codigoPessoal]);
  if (!reserva.rows[0]) return { ok: false, erro: "ja_respondida" };
  const replyTo = config.mailReplyTo() || config.contactBcc()[0], bcc = config.contactBcc();
  try {
    const r = await (o.enviar ?? sendMail)({ to: p.para, bcc, replyTo, subject: p.texto.assunto, text: p.texto.texto }, "resposta-contato");
    await query("UPDATE contact_replies SET ok=true, erro=$2 WHERE id=$1", [reserva.rows[0].id, r === "queued" ? "na fila de reenvio" : null]);
    if (p.card) {
      await (o.agendar ?? enqueueMail)({ to: p.para, bcc, replyTo, subject: p.card.assunto, text: p.card.texto, html: p.card.html }, "resposta-contato", "agendado (card, ~1 min depois)");
      await query("INSERT INTO contact_replies(contact_id,rodada,versao,user_id,por,assunto,codigo_pessoal,agendada,ok) VALUES($1,$2,'card',$3,$4,$5,$6,true,true) ON CONFLICT DO NOTHING", [o.contactId, rodada, o.por.userId || null, o.por.email, p.card.assunto, p.codigoPessoal]);
    }
    return { ok: true, texto: r === "queued" ? "na-fila" : "enviado", card: p.card ? "agendado" : "sem-codigo", rodada };
  } catch (e) {
    const msg = String((e as Error).message).slice(0, 300);
    await query("UPDATE contact_replies SET ok=false, erro=$2 WHERE id=$1", [reserva.rows[0].id, msg]);
    return { ok: false, erro: "falhou", detalhe: msg };
  }
}

export type Historico = { id: number; rodada: number; versao: string; por: string | null; assunto: string; ok: boolean; erro: string | null; agendada: boolean; criada_em: string };
export const historicoDeRespostas = async (ids: number[]): Promise<Record<number, Historico[]>> => {
  if (!ids.length) return {};
  const r = await query<Historico & { contact_id: number }>("SELECT id, contact_id, rodada, versao, por, assunto, ok, erro, agendada, criada_em FROM contact_replies WHERE contact_id = ANY($1::int[]) ORDER BY id", [ids]);
  const m: Record<number, Historico[]> = {};
  for (const x of r.rows) (m[x.contact_id] ??= []).push(x);
  return m;
};

/** Situação do cadastro de quem escreveu (para mostrar ao lado da mensagem). */
export async function situacaoDoCadastro(email: string): Promise<{ status: string; confirmada_em: string | null } | null> {
  const r = await query<{ status: string; confirmed_at: string | null }>("SELECT status, confirmed_at FROM signatures WHERE lower(email)=lower($1) ORDER BY id DESC LIMIT 1", [email]);
  return r.rows[0] ? { status: r.rows[0].status, confirmada_em: r.rows[0].confirmed_at } : null;
}
