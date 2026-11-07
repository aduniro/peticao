import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import nodemailer from "nodemailer";
import { config } from "../config";
import { assertSendAllowed } from "./guard";
import { isSuppressed, MailSuppressedError } from "./suppression";
import { readCredentialText, readSmtpCredential, sesSmtpOptions } from "./smtp-credential";
import { drainOutbox, enqueueMail } from "./outbox";
import { logQueued, type Attempt } from "./log";
import { withReplyTo } from "./payload";
import { journalFor, prepareRecorded, recordedQueueMail, type DeliveryJournal } from "./recorded";
import { messageMetadata } from "./archive";
import { receiptId, receiptJson, objectReceiptId, smtpInfoReceipt, mailersendReceipt, mailrelayReceipt, type TransportReceipt } from "./receipt";
import { credentialScope, snsScope, validAccountScope, sendpulseScope, mailrelayScope } from "./event-scope";
export { withReplyTo } from "./payload";
import { ordemRodizio, parsePesos, registrar } from "./rodizio";

export { MailSuppressedError };

export type Attachment = { filename: string; content: Buffer; contentType?: string };
export type Mail = { to: string; bcc?: string[]; replyTo?: string; subject: string; text: string; html?: string; attachments?: Attachment[] };

/** Caixa de saída do provedor "dev". Configurável para isolar testes que rodam em paralelo. */
export const outboxDir = () => process.env.MAIL_OUTBOX_DIR ?? join(process.cwd(), "data", "outbox");

async function sendDev(m: Mail) {
  mkdirSync(outboxDir(), { recursive: true });
  const name = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`;
  const attachments = m.attachments?.map((a) => ({ filename: a.filename, bytes: a.content.length, sha256: createHash("sha256").update(a.content).digest("hex") }));
  writeFileSync(join(outboxDir(), name), JSON.stringify({ ...m, attachments, at: new Date().toISOString() }, null, 2));
}

async function sendSmtp(m: Mail, from: string, provider = "smtp") {
  // Prioridade: SMTP_URL explícita; senão a credencial criptografada do SES entregue pelo systemd.
  const url = process.env.SMTP_URL;
  const cred = url ? null : readSmtpCredential();
  if (!url && !cred) throw new Error("SMTP não configurado (SMTP_URL ou credencial ses-smtp)");
  const transport = url ? nodemailer.createTransport(url) : nodemailer.createTransport(sesSmtpOptions(cred!));
  const notificationTopic=process.env.SES_SNS_TOPIC_ARN, sendingAccount=process.env.SES_SENDING_ACCOUNT_ID;
  const result = await transport.sendMail({ from, ...m });
  let awsHost = !url;
  if (url) { try { awsHost = /^email-smtp\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(new URL(url).hostname); } catch { awsHost = false; } }
  return provider === "ses" && awsHost ? { providerId: smtpInfoReceipt(result), accountScope: snsScope(notificationTopic,sendingAccount) } : undefined;
}

async function sendBrevo(m: Mail, fromHeader: string) {
  const key = process.env.BREVO_API_KEY ?? readCredentialText("brevo-api");
  if (!key) throw new Error("Brevo não configurado (BREVO_API_KEY ou credencial brevo-api)");
  const from = /^(.*)<(.+)>$/.exec(fromHeader);
  const sender = from ? { name: from[1].trim().replace(/^"|"$/g, ""), email: from[2] } : { email: fromHeader };
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": key, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      sender,
      to: [{ email: m.to }],
      ...(m.bcc?.length ? { bcc: m.bcc.map((email) => ({ email })) } : {}),
      ...(m.replyTo ? { replyTo: { email: m.replyTo } } : {}),
      subject: m.subject,
      textContent: m.text,
      ...(m.html ? { htmlContent: m.html } : {}),
      ...(m.attachments?.length ? { attachment: m.attachments.map((a) => ({ name: a.filename, content: a.content.toString("base64") })) } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Brevo respondeu ${res.status}`);
  return { providerId: objectReceiptId(await receiptJson(res), "messageId"), accountScope: credentialScope("brevo",key) };
}

/** Mailrelay (API v1, POST /send_emails). A conta tem endereço próprio (MAILRELAY_HOST = algo.ipzmarketing.com) e o remetente precisa estar confirmado lá. */
/** Duas contas Mailrelay, cada uma com o seu domínio e reputação: "mailrelay" (sancionaintegral.org) e "mailrelaypresidente" (sancionapresidente.org, canal de marketing). */
const mailrelayAccount = (which: "integral" | "presidente") => which === "presidente"
  ? { key: process.env.MAILRELAY_PRESIDENTE_API_KEY ?? readCredentialText("mailrelay-presidente-api"), host: process.env.MAILRELAY_PRESIDENTE_HOST, nome: "mailrelaypresidente" }
  : { key: process.env.MAILRELAY_API_KEY ?? readCredentialText("mailrelay-api"), host: process.env.MAILRELAY_HOST, nome: "mailrelay" };
const sendMailrelay = (m: Mail, from: string, onReceipt?: (receipt: TransportReceipt) => void) => sendMailrelayOf("integral", m, from, onReceipt);
const sendMailrelayPresidente = (m: Mail, from: string, onReceipt?: (receipt: TransportReceipt) => void) => sendMailrelayOf("presidente", m, from, onReceipt);
async function sendMailrelayOf(which: "integral" | "presidente", m: Mail, fromHeader: string, onReceipt?: (receipt: TransportReceipt) => void) {
  const { key, host, nome } = mailrelayAccount(which);
  if (!key || !host || !/^[a-z0-9-]+\.ipzmarketing\.com$/.test(host)) throw new Error(`Mailrelay não configurado para "${nome}" (host e chave da API)`);
  if (m.attachments?.length) throw new Error("Mailrelay: anexos não suportados neste provedor");
  const parsed = /^(.*)<(.+)>$/.exec(fromHeader);
  const from = parsed ? { name: parsed[1].trim().replace(/^"|"$/g, ""), email: parsed[2] } : { email: fromHeader };
  const post = async (to: string) => {
    const res = await fetch(`https://${host}/api/v1/send_emails`, {
      method: "POST",
      headers: { "X-AUTH-TOKEN": key, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ from, to: [{ email: to }], ...(m.replyTo ? { reply_to: { email: m.replyTo } } : {}), subject: m.subject, text_part: m.text, ...(m.html ? { html_part: m.html } : {}) }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Mailrelay respondeu ${res.status}${body ? `: ${body.replace(/\s+/g, " ").slice(0, 140)}` : ""}`);
    }
    return { providerId: mailrelayReceipt(await receiptJson(res), to), accountScope: mailrelayScope(nome,host,key) };
  };
  const primary = await post(m.to);
  onReceipt?.(primary);
  for (const b of m.bcc ?? []) await post(b); // cópia oculta como envio separado: o campo bcc da API não é documentado
  return primary;
}

/**
 * SendPulse (API SMTP): autentica com ID e segredo ("Credenciais do cliente") por OAuth; o token vale ~1 h e fica em memória.
 * O corpo HTML vai em Base64, como a API exige. O remetente precisa estar ativo no SendPulse e no mesmo domínio do domínio de envio autenticado.
 */
type SpCreds = { id: string; secret: string };
const spToken = { value: "", exp: 0, scope: "" };
export function sendpulseCreds(): SpCreds | null {
  const id = process.env.SENDPULSE_CLIENT_ID ?? readCredentialText("sendpulse-id");
  const secret = process.env.SENDPULSE_CLIENT_SECRET ?? readCredentialText("sendpulse-secret");
  return id && secret ? { id, secret } : null;
}
export const _clearSendpulseToken = () => { spToken.value = ""; spToken.exp = 0; spToken.scope = ""; };
export async function sendSendpulseWith(fetchImpl: typeof fetch, creds: SpCreds, m: Mail, fromHeader: string) {
  const accountScope=sendpulseScope(creds.id,creds.secret);
  if (!spToken.value || spToken.exp < Date.now() + 60_000 || !accountScope || spToken.scope!==accountScope) {
    const r = await fetchImpl("https://api.sendpulse.com/oauth/access_token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials", client_id: creds.id, client_secret: creds.secret }), signal: AbortSignal.timeout(15_000) });
    const j = (await r.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
    if (!r.ok || !j.access_token) throw new Error(`SendPulse: autenticação recusada (HTTP ${r.status})`);
    spToken.value = j.access_token; spToken.exp = Date.now() + (j.expires_in ?? 3600) * 1000; spToken.scope=accountScope??"";
  }
  const parsed = /^(.*)<(.+)>$/.exec(fromHeader);
  const from = parsed ? { name: parsed[1].trim().replace(/^"|"$/g, ""), email: parsed[2] } : { name: "", email: fromHeader };
  const email: Record<string, unknown> = {
    subject: m.subject, from, to: [{ name: "", email: m.to }], text: m.text,
    ...(m.html ? { html: Buffer.from(m.html, "utf8").toString("base64") } : {}),
    ...(m.replyTo ? { reply_to: { name: "", email: m.replyTo } } : {}),
    ...(m.bcc?.length ? { bcc: m.bcc.map((e) => ({ name: "", email: e })) } : {}),
    ...(m.attachments?.length ? { attachments_binary: Object.fromEntries(m.attachments.map((a) => [a.filename, a.content.toString("base64")])) } : {}),
  };
  const res = await fetchImpl("https://api.sendpulse.com/smtp/emails", { method: "POST", headers: { Authorization: `Bearer ${spToken.value}`, "content-type": "application/json" }, body: JSON.stringify({ email }), signal: AbortSignal.timeout(30_000) });
  if (res.status === 401) _clearSendpulseToken();
  if (!res.ok) { const body = await res.text().catch(() => ""); throw new Error(`SendPulse respondeu ${res.status}${body ? `: ${body.replace(/\s+/g, " ").slice(0, 140)}` : ""}`); }
  const j = (await res.json().catch(() => ({}))) as { result?: boolean; id?: string };
  if (j.result === false) throw new Error("SendPulse recusou o envio (result=false)");
  return { providerId: objectReceiptId(j,"id"), accountScope };
}
async function sendSendpulse(m: Mail, from: string) {
  const c = sendpulseCreds();
  if (!c) throw new Error("SendPulse não configurado (SENDPULSE_CLIENT_ID/SECRET ou credenciais sendpulse-id e sendpulse-secret)");
  return sendSendpulseWith(fetch, c, m, from);
}

/**
 * MailerSend (API REST): POST /v1/email com o token Bearer (só permissão de envio). Responde 202 sem corpo.
 * O remetente precisa ser de um domínio verificado no MailerSend (aqui, o subdomínio dedicado envia.sancionaintegral.org).
 */
export async function sendMailersendWith(fetchImpl: typeof fetch, token: string, m: Mail, fromHeader: string) {
  const parsed = /^(.*)<(.+)>$/.exec(fromHeader);
  const from = parsed ? { name: parsed[1].trim().replace(/^"|"$/g, ""), email: parsed[2] } : { email: fromHeader };
  const body: Record<string, unknown> = {
    from, to: [{ email: m.to }], subject: m.subject, text: m.text,
    ...(m.html ? { html: m.html } : {}),
    ...(m.replyTo ? { reply_to: { email: m.replyTo } } : {}),
    ...(m.bcc?.length ? { bcc: m.bcc.map((email) => ({ email })) } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64"), disposition: "attachment" })) } : {}),
  };
  const res = await fetchImpl("https://api.mailersend.com/v1/email", { method: "POST", headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", "x-requested-with": "XMLHttpRequest" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
  if (!res.ok) { const t = await res.text().catch(() => ""); throw new Error(`MailerSend respondeu ${res.status}${t ? `: ${t.replace(/\s+/g, " ").slice(0, 140)}` : ""}`); }
  return { providerId: mailersendReceipt(res), accountScope: credentialScope("mailersend",token) };
}
async function sendMailersend(m: Mail, from: string) {
  const token = process.env.MAILERSEND_API_TOKEN ?? readCredentialText("mailersend-api");
  if (!token) throw new Error("MailerSend não configurado (MAILERSEND_API_TOKEN ou credencial mailersend-api)");
  return sendMailersendWith(fetch, token, m, from);
}

export type Sender = (m: Mail, from: string, onReceipt?: (receipt: TransportReceipt) => void) => Promise<void | TransportReceipt>;
/** Provedores conhecidos. "ses" e "smtp" usam SMTP (a credencial do SES vem do systemd); "brevo" e "mailrelay" usam API HTTPS. */
const SENDERS: Record<string, Sender> = { dev: async (m) => sendDev(m), smtp: (m, from) => sendSmtp(m, from), ses: (m, from) => sendSmtp(m, from, "ses"), brevo: sendBrevo, mailrelay: sendMailrelay, mailrelaypresidente: sendMailrelayPresidente, sendpulse: sendSendpulse, mailersend: sendMailersend };

/**
 * Tenta cada provedor da cadeia, na ordem; se um falhar (credencial ausente, sandbox, fora do ar), passa ao próximo,
 * cada um com o seu remetente (subdomínio próprio). Só lança erro se todos falharem. Nunca registra segredos.
 */
export async function deliver(m: Mail, providers: string[], senders: Record<string, Sender> = SENDERS, fromFor: (p: string, kind?: string) => string = config.mailFromFor, kind?: string, onAttempt?: (a: Attempt) => void, opts: { singleAttempt?: boolean; journal?: DeliveryJournal } = {}): Promise<string> {
  const errors: string[] = [];
  const notify = (attempt: Attempt) => { try { onAttempt?.(attempt); } catch { console.error("mail_attempt_callback_failed"); } };
  for (const p of providers) {
    const send = senders[p];
    if (!send) { errors.push(`${p}: provedor desconhecido`); continue; }
    let from = "";
    try { from = fromFor(p,kind); }
    catch(error) { errors.push(`${p}: ${(error as Error).message.slice(0,160)}`); notify({provider:p,from,ok:false,error:(error as Error).message}); if(opts.singleAttempt)throw error; continue; }
    // Admission failures are not transport failures and never cause an unrecorded provider call.
    const admission = await opts.journal?.begin(p,from);
    if (admission?.alreadyAccepted) return p;
    let failure: unknown,accepted=false,providerReceipt: string | undefined, providerScope: string | undefined, conflictingReceipt=false;
    const capture = (raw: unknown) => {
      const id=receiptId(raw); if (!id) return;
      let scope: unknown; try { scope=(raw as TransportReceipt).accountScope; } catch { /* Missing scope must not change acceptance. */ }
      if (providerReceipt && providerReceipt!==id || validAccountScope(scope) && providerScope && providerScope!==scope) conflictingReceipt=true;
      providerReceipt=id; if(validAccountScope(scope))providerScope=scope;
    };
    try { const result=await send(m,from,capture); accepted=true; capture(result); } catch(error) { failure=error; }
    if(admission?.id) {
      try { await opts.journal!.finish(admission.id,accepted,failure,providerReceipt&&!conflictingReceipt?{providerId:providerReceipt,accountScope:providerScope}:undefined); }
      catch { console.error("mail_attempt_result_unconfirmed"); }
    }
    if(accepted) {
      notify({provider:p,from,ok:true});
      if(errors.length)console.warn(`e-mail enviado por "${p}" depois de falha em: ${errors.join(" | ")}`);
      return p;
    }
    const error=failure instanceof Error ? failure : new Error("mail_transport_error");
    errors.push(`${p}: ${error.message.slice(0,160)}`);notify({provider:p,from,ok:false,error:error.message});
    if(opts.singleAttempt)throw error;
  }
  throw new Error(`Nenhum provedor de e-mail conseguiu enviar (${errors.join(" | ")})`);
}

export type SendOutcome = "sent" | "queued";

/**
 * Único ponto de saída de e-mail: sempre passa pela trava antes dos provedores.
 * Se NENHUM provedor conseguir enviar, a mensagem vai para a fila de reenvio (tentada de novo automaticamente, em intervalos crescentes,
 * até 48 h) em vez de se perder. Endereços bloqueados continuam sendo recusados na hora.
 */
async function checkEnvelope(m: Mail,providers:string[]) {
  assertSendAllowed(m.to);for(const recipient of m.bcc??[])assertSendAllowed(recipient);
  const real=providers.some(provider=>provider!=="dev");
  if(process.env.PREVIEW_MODE==="1"&&real)throw new Error("PREVIEW_MODE só permite MAIL_PROVIDER=dev (caixa de saída local).");
  if(real&&await isSuppressed(m.to))throw new MailSuppressedError(`Endereço na lista de supressão: ${m.to}`);
}

const backgroundMail = new Set<Promise<unknown>>();
function scheduleDrain() {
  const work=new Promise<void>(resolve=>setImmediate(resolve)).then(()=>drainMailOutbox(3)).catch(()=>{});
  backgroundMail.add(work);void work.finally(()=>backgroundMail.delete(work));
}
/** Allows a controlled shutdown/test to wait for the existing opportunistic drains. */
export async function waitForBackgroundMail() { while(backgroundMail.size)await Promise.all([...backgroundMail]); }

export async function sendMail(m: Mail, kind = "geral", opts: { queue?: boolean; channel?: "transactional" | "marketing"; avoid?: string[]; singleAttempt?: boolean; messageKey?:string } = {}): Promise<SendOutcome> {
  const channel=opts.channel??"transactional",providers=channel==="marketing"?config.marketingProviders():config.mailProviders();
  if(channel==="marketing"&&!providers.length)throw new Error("Canal de marketing não configurado (MAIL_PROVIDERS_MARKETING)");
  await checkEnvelope(m,providers);
  const effective=withReplyTo(m),record=await prepareRecorded(effective,kind,channel,opts.messageKey);
  const rotationChannel=channel==="marketing"?"marketing":"transacional";
  const order=ordemRodizio(rotationChannel,providers,parsePesos(channel==="marketing"?config.mailRotationMarketing():config.mailRotation()),{evitar:opts.avoid});
  try {
    await deliver(effective,order,SENDERS,channel==="marketing"?config.mailFromMarketing:config.mailFromFor,kind,a=>registrar(rotationChannel,a.provider,a.ok),{singleAttempt:opts.singleAttempt,journal:journalFor(record.id,!opts.singleAttempt)});
  } catch(error) {
    if(channel==="marketing"||!providers.some(p=>p!=="dev")||opts.queue===false)throw error;
    const id=await enqueueMail(effective,kind,(error as Error).message,record.id);
    await logQueued(effective,kind,(error as Error).message,record.id);
    console.warn(`e-mail #${id} (${kind}) para a fila de reenvio: ${(error as Error).message.slice(0,160)}`);
    return "queued";
  }
  if(channel!=="marketing")scheduleDrain();
  return "sent";
}

/** Queue retries retain identity and the observed envelope, including previously missing Reply-To defaults. */
export const drainMailOutbox = (limit = 20) => drainOutbox(async (raw,kind,context) => {
  if(!context)throw new Error("mail_queue_context_missing");
  const record=await recordedQueueMail(raw,kind,context),metadata=await messageMetadata(record.id);
  if(metadata?.status==="accepted")return;
  const providers=config.mailProviders();await checkEnvelope(record.mail,providers);
  return deliver(record.mail,providers,SENDERS,config.mailFromFor,kind,undefined,{journal:journalFor(record.id,true)});
},limit);
