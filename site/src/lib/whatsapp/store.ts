import { randomBytes } from "node:crypto";
import { query } from "../db";
import { cifrar, decifrar, impressao } from "../crypto-dados";
import { sha256 } from "../security";
import { waProvider, waTemplates } from "./provider";

/** Número de WhatsApp cifrado (AES-256-GCM, contexto = id da assinatura); só o painel decifra. O token do link guarda apenas o hash. */
const TTL_HORAS = 48;
const primeiroNome = (n: string) => n.trim().split(/\s+/)[0] ?? "";

async function registrar(signatureId: number, e164: string): Promise<string> {
  const token = randomBytes(24).toString("base64url");
  await query(
    "UPDATE signatures SET wa_cipher=$2, wa_fp=$3, wa_optin_at=now(), wa_token_hash=$4, wa_token_expires_at=now() + ($5 || ' hours')::interval WHERE id=$1",
    [signatureId, cifrar(e164, `wa:${signatureId}`), impressao(e164), sha256(token), String(TTL_HORAS)]
  );
  return token;
}

async function log(signatureId: number | null, kind: string, status: string, providerId?: string, error?: string) {
  await query("INSERT INTO whatsapp_messages(signature_id,kind,status,provider_id,error) VALUES($1,$2,$3,$4,$5)", [signatureId, kind, status, providerId ?? null, error ? error.slice(0, 300) : null]).catch(() => {});
}

/** Guarda o número e envia o pedido de confirmação (link para /confirmar/whatsapp). Sem provedor ativo, não faz nada (nem guarda o número). */
export async function pedirWhatsapp(signatureId: number, nome: string, e164: string): Promise<void> {
  const p = waProvider();
  if (!p) return;
  const token = await registrar(signatureId, e164);
  try {
    const r = await p.send({ to: e164, templateId: waTemplates().pedido, body: [primeiroNome(nome)], buttons: [token] });
    await log(signatureId, "pedido", "sent", r.id);
  } catch (e) { await log(signatureId, "pedido", "failed", undefined, e instanceof Error ? e.message : String(e)); }
}

/** Aviso padrão de assinatura confirmada pelo WhatsApp (se a pessoa informou número, aceitou o uso e o recurso está ligado). */
export async function notificarConfirmacaoWhatsapp(signatureId: number): Promise<void> {
  const p = waProvider();
  if (!p) return;
  const r = (await query<{ wa_cipher: string | null; wa_optin_at: string | null; name: string }>("SELECT wa_cipher, wa_optin_at, name FROM signatures WHERE id=$1 AND status='confirmed'", [signatureId])).rows[0];
  if (!r?.wa_cipher || !r.wa_optin_at) return;
  const numero = decifrar(r.wa_cipher, `wa:${signatureId}`);
  if (!numero) return;
  try {
    const x = await p.send({ to: numero, templateId: waTemplates().pronto, body: [primeiroNome(r.name)] });
    await log(signatureId, "confirmada", "sent", x.id);
  } catch (e) { await log(signatureId, "confirmada", "failed", undefined, e instanceof Error ? e.message : String(e)); }
}

/** Dados do cadastro ligados a um token de WhatsApp pendente (para a página /confirmar/whatsapp). Não devolve o número. */
export async function pendentePorToken(token: string): Promise<{ id: number; name: string; category: string; cpfHash: string | null } | null> {
  if (!token || token.length > 200) return null;
  const r = (await query<{ id: number; name: string; category: string; cpf_hash: string | null }>(
    "SELECT id, name, category, cpf_hash FROM signatures WHERE wa_token_hash=$1 AND status='pending' AND wa_token_expires_at > now()", [sha256(token)])).rows[0];
  return r ? { id: r.id, name: r.name, category: r.category, cpfHash: r.cpf_hash } : null;
}

/** Atualiza o estado de uma mensagem a partir do webhook do provedor (whatsapp.sent/delivered/read/failed). */
export async function atualizarStatusMensagem(providerId: string, status: "sent" | "delivered" | "read" | "failed", error?: string): Promise<number> {
  const r = await query("UPDATE whatsapp_messages SET status=$2, error=COALESCE($3,error), updated_at=now() WHERE provider_id=$1", [providerId, status, error ?? null]);
  return r.rowCount ?? 0;
}
