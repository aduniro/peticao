import { query, audit, tx } from "./db";
import { config } from "./config";
import { hmac, newToken, normalizeEmail, sha256 } from "./security";
import { dedupEmail } from "./email-check";
import { SAFE_EMAIL_RE } from "./email-syntax";
import { validateEmailField } from "./email-validate";
import { institutionInfo, institutionalKind } from "./institutional";
import { isSuppressed } from "./mail/suppression";
import { sendMail } from "./mail";
import { confirmationMail } from "./signatures";
import { sugerir } from "./email-sugestao";

const mask = (e: string) => e.replace(/^(.{2}).*(@.+)$/, "$1***$2");
export type EmailActor = string | { userId: number; email: string };
export type Resultado = { ok: true; email?: string; version?: string; envio?: "sent" | "queued" } | { ok: false; erro: string; code?: string };

/**
 * Corrige o e-mail de um cadastro PENDENTE (erro de digitação). Só mexe em e-mail, hash do e-mail e selo institucional:
 * data de cadastro, número, código de verificação e o resto do registro ficam como estão. Fica na auditoria (e-mails mascarados).
 */
export async function corrigirEmail(id: number, novo: string, actor: EmailActor = "admin", expectedVersion?: string): Promise<Resultado> {
  if (!Number.isSafeInteger(id) || id < 1 || id > 2147483647) return { ok: false, erro: "Cadastro não encontrado." };
  const r = (await query<{ id: number; status: string; category: string; email: string; version: string }>("SELECT id,status,category,email,xmin::text AS version FROM signatures WHERE id=$1", [id])).rows[0];
  if (!r) return { ok: false, erro: "Cadastro não encontrado." };
  if (r.status !== "pending") return { ok: false, erro: "Só dá para corrigir o e-mail de cadastros pendentes." };
  if (expectedVersion !== undefined && expectedVersion !== r.version) return { ok: false, erro: "Não foi possível salvar.", code: "conflict" };
  const email = normalizeEmail(novo);
  if (!SAFE_EMAIL_RE.test(email)) return { ok: false, erro: "E-mail com formato inválido." };
  if (r.category === "servidor" || r.category === "apoiador") {
    const v = await validateEmailField(email, r.category);
    if (!v.ok) return { ok: false, erro: v.code === "server_email_not_institutional" ? "Servidor precisa de e-mail institucional." : v.code === "apoiador_institutional_email" ? "E-mail institucional: o cadastro deveria ser de servidor." : "Domínio do e-mail inválido ou sem servidor de e-mail." };
  }
  if (await isSuppressed(email)) return { ok: false, erro: "Este endereço está na lista de supressão (já devolveu ou reclamou)." };
  const h = hmac(dedupEmail(email));
  const outro = await query("SELECT 1 FROM signatures WHERE email_hash=$1 AND id<>$2", [h, id]);
  if (outro.rowCount) return { ok: false, erro: "Já existe outro cadastro com este e-mail." };
  const kind = r.category === "estrangeiro" ? null : await institutionalKind(email);
  const inst = kind ? await institutionInfo(email) : { domain: null, institution: null };
  try {
    return await tx<Resultado>(async c => {
      // Validation may await DNS/provider metadata. Never hold a signer lock during that work.
      // Recheck both the actor and the exact row version before applying those results.
      if (typeof actor !== "string" && !(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel IN ('edicao','exclusao','total') FOR SHARE", [actor.userId, actor.email.toLowerCase()])).rowCount) {
        return { ok: false, erro: "O seu nível de acesso não permite esta ação.", code: "forbidden" };
      }
      const current = (await c.query<{ status: string; version: string }>("SELECT status,xmin::text AS version FROM signatures WHERE id=$1 FOR UPDATE", [id])).rows[0];
      if (!current) return { ok: false, erro: "Cadastro não encontrado." };
      if (current.status !== "pending") return { ok: false, erro: "Só dá para corrigir o e-mail de cadastros pendentes." };
      // Existing UI fallback until the more specific conflict notice is approved.
      if (current.version !== r.version) return { ok: false, erro: "Não foi possível salvar.", code: "conflict" };
      const changed = await c.query<{ version: string }>("UPDATE signatures SET email=$1, email_hash=$2, email_domain_kind=$3, email_domain=$4, email_institution=$5 WHERE id=$6 RETURNING xmin::text AS version", [email, h, kind, inst.domain, inst.institution, id]);
      await audit("email_corrigido", id, { de: mask(r.email), para: mask(email), por: typeof actor === "string" ? actor : actor.email.toLowerCase(), ...(typeof actor === "string" ? {} : { userId: actor.userId }) }, c);
      return { ok: true, email, version: changed.rows[0].version };
    });
  } catch (error) {
    // A concurrent signup can acquire the same hash after the preliminary duplicate check.
    if ((error as { code?: string; constraint?: string }).code === "23505" && (error as { constraint?: string }).constraint === "signatures_email_hash_key") return { ok: false, erro: "Já existe outro cadastro com este e-mail." };
    throw error;
  }
}

/** Aplica a sugestão calculada AGORA no servidor (nunca confia no que o navegador mostrou). */
export async function aceitarSugestao(id: number, actor: EmailActor = "admin", expectedVersion?: string): Promise<Resultado> {
  const r = (await query<{ email: string; version: string }>("SELECT email,xmin::text AS version FROM signatures WHERE id=$1 AND status='pending'", [id])).rows[0];
  if (!r) return { ok: false, erro: "Cadastro pendente não encontrado." };
  if (expectedVersion !== undefined && expectedVersion !== r.version) return { ok: false, erro: "Não foi possível salvar.", code: "conflict" };
  const s = await sugerir(r.email);
  if (!s.sugestao) return { ok: false, erro: "Não há sugestão para este e-mail." };
  return corrigirEmail(id, s.sugestao, actor, r.version);
}

/** Reenvia o e-mail de confirmação (token novo; vale a data original do cadastro no texto). No máximo 1 vez a cada 10 minutos por cadastro. */
export async function reenviarConfirmacao(id: number, por = "admin"): Promise<Resultado> {
  const r = (await query<{ id: number; name: string; email: string; status: string; created_at: string }>("SELECT id,name,email,status,created_at FROM signatures WHERE id=$1", [id])).rows[0];
  if (!r) return { ok: false, erro: "Cadastro não encontrado." };
  if (r.status !== "pending") return { ok: false, erro: "Só cadastros pendentes recebem o reenvio." };
  if (await isSuppressed(r.email)) return { ok: false, erro: "Endereço na lista de supressão: corrija o e-mail antes de reenviar." };
  const ult = await query<{ n: number }>("SELECT COUNT(*)::int n FROM mail_log WHERE lower(to_addr)=lower($1) AND kind='confirmacao' AND ts > now() - interval '10 minutes'", [r.email]);
  if (ult.rows[0].n > 0) return { ok: false, erro: "Já houve um envio para este e-mail há menos de 10 minutos." };
  const token = newToken();
  await query("UPDATE signatures SET token_hash=$1, token_expires_at=$2 WHERE id=$3", [sha256(token), new Date(Date.now() + config.tokenTtlHours * 3600_000).toISOString(), id]);
  let envio: "sent" | "queued";
  try { envio = await sendMail({ to: normalizeEmail(r.email), ...confirmationMail(r.name, token, r.created_at) }, "confirmacao"); }
  catch (e) { return { ok: false, erro: `Não foi possível enviar: ${String((e as Error).message).slice(0, 120)}` }; }
  await audit("confirmacao_reenviada", id, { para: mask(r.email), envio, por });
  return { ok: true, email: r.email, envio };
}
