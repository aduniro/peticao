import { reserveDocumentReferenceTx, snapshotReferenceMatchesTx } from "./document-reference-store";
import { a1PreparationEnabledTx } from "./batch-a1-jobs";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { config } from "./config";
import { audit, query, tx } from "./db";
import { buildBatchPdf, ListRow } from "./pdf";
import { assertSendable, signPdf, signerNote } from "./signer";
import { hmac, safeEqual, sha256 } from "./security";
import { sendMail } from "./mail";
import type { Mail } from "./mail";
/** Envios que o admin acompanha (código de aprovação, entrega às autoridades): se falharem, o erro aparece na hora e nada vai para a fila. */
const sendNow = (m: Mail, kind = "lote", messageKey?: string, frozenReplyTo = false) => sendMail(m, kind, { queue: false, ...(messageKey ? { messageKey, singleAttempt: true } : {}), ...(frozenReplyTo ? { frozenReplyTo: true } : {}) });
import { purgeOldEvents } from "./track";
import { checkSignedPdf, verifyIcpBrasil } from "./signed-pdf";
import type { PoolClient } from "pg";
import { rejectedBatchRecipients } from "./batch-rejection";
import { frozenReplyTo, withReplyTo } from "./mail/payload";
import { freezePreparation, thawPreparation, type CreationSource } from "./batch-preparation";
import { appendDocumentVersion, preserveObservedDocument } from "./batch-document-history";
import { pendingBatchDeliveryTx, resolveBatchDeliveryTx, type DeliveryBinding } from "./batch-delivery";
import { batchPackageDispatchReadyTx } from "./batch-package-store";

export type BatchActor = { userId: number; email: string; sessaoId?: string | null };
const actorData = (actor: BatchActor) => ({ userId: actor.userId, por: actor.email.trim().toLowerCase() });
export async function authorizeBatchActor(client: PoolClient, actor: BatchActor) {
  if (!actor || !Number.isInteger(actor.userId) || actor.userId <= 0 || actor.userId > 2147483647 || typeof actor.email !== "string" || actor.email.length > 254) return false;
  await client.query("SELECT pg_advisory_xact_lock(7003)");
  return !!(await client.query("SELECT 1 FROM admin_users WHERE id=$1 AND email=$2 AND ativo AND nivel='total' FOR SHARE", [actor.userId, actor.email.trim().toLowerCase()])).rowCount;
}

export type Batch = {
  id: number; seq: number; kind: "partial" | "final"; status: string; n_servidor: number; n_apoiador: number; n_estrangeiro: number;
  list_hash: string; pdf_sha256: string | null; signature_kind: string | null; signed_note?: string | null; approved_at: string | null; sent_at: string | null; created_at: string;
};

const COLS = "id,seq,kind,status,n_servidor,n_apoiador,n_estrangeiro,list_hash,pdf_sha256,signature_kind,signed_note,approved_at,sent_at,created_at";
export const LIST_SQL = `SELECT id,seq,verify_code,confirmed_at,region_validated,campus_ibge,name,category,role,institution,city,uf,country,university,campus,email_domain_kind,cpf_name_check FROM signatures`;

/** Contagens dos selos informativos (não são filtros: ninguém é excluído da lista por não ter selo). */
export function badgeCounts(rows: ListRow[]) {
  const inst = rows.filter((r) => r.email_domain_kind && r.email_domain_kind !== "discente").length;
  return {
    nInstitucional: inst,
    nDiscente: rows.filter((r) => r.email_domain_kind === "discente").length,
    nNomeConferido: rows.filter((r) => r.cpf_name_check === "match").length,
  };
}

export async function getSetting(key: string, def: string): Promise<string> {
  const r = await query<{ value: string }>("SELECT value FROM settings WHERE key=$1", [key]);
  return r.rows[0]?.value ?? def;
}
export async function setSetting(key: string, value: string) {
  await query("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value", [key, value]);
}
export const sendingEnabled = async () => (await getSetting("sending_enabled", "true")) === "true";

export async function listBatches(): Promise<Batch[]> {
  return (await query<Batch>(`SELECT ${COLS} FROM batches ORDER BY seq DESC`)).rows;
}
export async function getBatch(id: number): Promise<Batch | null> {
  return (await query<Batch>(`SELECT ${COLS} FROM batches WHERE id=$1`, [id])).rows[0] ?? null;
}

/**
 * Fecha um lote com as assinaturas confirmadas ainda sem lote.
 * "partial": só quando houver pelo menos BATCH_SIZE assinaturas novas. "final": qualquer quantidade (> 0).
 * Os dois PDFs são acumulados: cada versão enviada ao Governo traz todas as assinaturas confirmadas até ali (as "novas" só marcam o lote em que cada uma entrou).
 * Retorna null se não houver o que fechar.
 */
const creationData = (source: CreationSource) => source.kind === "admin" ? { source: "admin", ...actorData(source.actor) } : { source: "scheduler" };
/** Internal scheduler path; manual HTTP creation must use createBatchForAdmin. */
export const createBatch = (kind: "partial" | "final") => createBatchFrom(kind, { kind: "scheduler" });
export const createBatchForAdmin = (kind: "partial" | "final", actor: BatchActor) => createBatchFrom(kind, { kind: "admin", actor });

async function createBatchFrom(kind: "partial" | "final", source: CreationSource): Promise<Batch | null> {
  const created = await tx(async (c) => {
    if (source.kind === "admin" && !(await authorizeBatchActor(c, source.actor))) throw new Error("Lote não está pronto para aprovação.");
    await c.query("SELECT pg_advisory_xact_lock(7002)");
    if (kind === "final") {
      const f = await c.query("SELECT 1 FROM batches WHERE kind='final' AND status <> 'cancelled'");
      if (f.rowCount) return null; // só um lote final ativo
    }
    const pend = await c.query<{ id: number }>("SELECT id FROM signatures WHERE status='confirmed' AND batch_id IS NULL ORDER BY id FOR UPDATE");
    if (pend.rowCount === 0) return null;
    if (kind === "partial" && pend.rowCount! < config.batchSize()) return null;
    const seq = (await c.query<{ n: number }>("SELECT COALESCE(MAX(seq),0)::int+1 n FROM batches")).rows[0].n;
    const scope = "status='confirmed'";
    const rows = (await c.query<ListRow & { category: string }>(`${LIST_SQL} WHERE ${scope} ORDER BY confirmed_at, id`)).rows;
    const nS = rows.filter((r) => r.category === "servidor").length;
    const nE = rows.filter((r) => r.category === "estrangeiro").length;
    const listHash = sha256(JSON.stringify(rows));
    const ins = await c.query<{ id: number }>(
      "INSERT INTO batches(seq,kind,n_servidor,n_apoiador,n_estrangeiro,list_hash) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",
      [seq, kind, nS, rows.length - nS - nE, nE, listHash]
    );
    const id = ins.rows[0].id;
    await c.query("UPDATE signatures SET batch_id=$1 WHERE status='confirmed' AND batch_id IS NULL AND id=ANY($2::int[])", [id, rows.map(row => row.id)]);
    const documentReference = await reserveDocumentReferenceTx(c,id,source.kind === "admin" ? source.actor.userId : null);
    const a1Preparation = await a1PreparationEnabledTx(c);
    const frozen = freezePreparation(rows, { seq, kind, generatedAt: new Date().toISOString(), listHash, nServidor: nS, nApoiador: rows.length - nS - nE, nEstrangeiro: nE, signedNote: signerNote(a1Preparation ? "a1" : undefined), ...(a1Preparation ? { signaturePreparation: "a1" as const } : {}), ...(documentReference ? { documentReference } : {}), origin: config.appUrl(), ...badgeCounts(rows) }, source);
    await c.query("INSERT INTO batch_preparations(batch_id,snapshot,snapshot_sha256) VALUES($1,$2,$3)", [id, frozen.snapshot, frozen.sha256]);
    await audit("batch_created", null, { batchId: id, seq, kind, n: rows.length, listHash, snapshotSha256: frozen.sha256, ...creationData(source) }, c);
    return { id, seq, rows, nS, nE, listHash };
  });
  if (!created) return null;

  const { id } = created;
  try {
    const prepared = await prepareReservedBatch(id, source);
    if (!prepared.ok) throw new Error("Lote não está pronto para aprovação.");
  } catch (e) {
    await audit("batch_prepare_failed", null, { batchId: id, error: String(e).slice(0, 200), ...creationData(source) });
    throw e;
  }
  await notifyApprover(id).catch((e) => console.error("aviso ao aprovador falhou", e));
  return getBatch(id);
}

type PreparationRow = { snapshot: string; snapshot_sha256: string; lease_token: string | null; lease_until: Date | null };
/** A process may claim only an unprepared document. Expired workers cannot publish over a newer lease. */
async function prepareReservedBatch(id: number, source: CreationSource, recovery = false) {
  const token = randomUUID();
  const claim = await tx(async client => {
    await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
    if (source.kind === "admin" && !(await authorizeBatchActor(client, source.actor))) return { ok: false as const, error: "forbidden" };
    const batch = (await client.query<ApprovalRow>("SELECT * FROM batches WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!batch || batch.status !== "preparing" || batch.pdf || batch.signed_pdf || batch.approved_at) return { ok: false as const, error: "conflict" };
    const row = (await client.query<PreparationRow>("SELECT * FROM batch_preparations WHERE batch_id=$1 FOR UPDATE", [id])).rows[0];
    const frozen = row && thawPreparation(row.snapshot, row.snapshot_sha256, batch);
    if (!frozen || !await snapshotReferenceMatchesTx(client,id,frozen.meta.documentReference)) return { ok: false as const, error: "snapshot" };
    const auditRows = (await client.query<{ data: string }>("SELECT data FROM audit_log WHERE event='batch_created' AND data::jsonb->>'batchId'=$1 ORDER BY id LIMIT 2", [String(id)])).rows;
    if (auditRows.length !== 1 || JSON.parse(auditRows[0].data).snapshotSha256 !== row.snapshot_sha256) return { ok: false as const, error: "snapshot" };
    const claimed = await client.query("UPDATE batch_preparations SET lease_token=$2,lease_until=now()+interval '5 minutes',attempts=attempts+1,last_error=NULL WHERE batch_id=$1 AND (lease_token IS NULL OR lease_until<=now()) RETURNING batch_id", [id, token]);
    if (!claimed.rowCount) return { ok: false as const, error: "busy" };
    if (recovery) await audit("batch_preparation_recovery_started", null, { batchId: id, snapshotSha256: row.snapshot_sha256, ...creationData(source) }, client);
    return { ok: true as const, frozen, sha256: row.snapshot_sha256 };
  });
  if (!claim.ok) return claim;
  try {
    const unsigned = await buildBatchPdf(claim.frozen.rows, claim.frozen.meta);
    const signed = await signPdf(unsigned), sha = createHash("sha256").update(signed.bytes).digest("hex");
    return await tx(async client => {
      await client.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
      if (source.kind === "admin" && !(await authorizeBatchActor(client, source.actor))) throw new Error("Lote não está pronto para aprovação.");
      const batch = (await client.query<ApprovalRow>("SELECT * FROM batches WHERE id=$1 FOR UPDATE", [id])).rows[0];
      const row = (await client.query<PreparationRow & { current: boolean }>("SELECT *,lease_until>now() current FROM batch_preparations WHERE batch_id=$1 FOR UPDATE", [id])).rows[0];
      if (!batch || batch.status !== "preparing" || batch.pdf || batch.signed_pdf || batch.approved_at || !row || row.lease_token !== token || !row.current || row.snapshot_sha256 !== claim.sha256 || !thawPreparation(row.snapshot, row.snapshot_sha256, batch) || !await snapshotReferenceMatchesTx(client,id,claim.frozen.meta.documentReference)) throw new Error("Lote não está pronto para aprovação.");
      await appendDocumentVersion(client, { batchId:id, variant:"original", bytes:Buffer.from(signed.bytes), sha256:sha, listHash:batch.list_hash, signatureKind:signed.kind, note:null, source:"prepared", authorId:claim.frozen.source.kind === "admin" ? claim.frozen.source.actor.userId : null, recordedBy:source.kind === "admin" ? source.actor.userId : null });
      await client.query("UPDATE batches SET pdf=$1,pdf_sha256=$2,signature_kind=$3,status='prepared' WHERE id=$4", [Buffer.from(signed.bytes), sha, signed.kind, id]);
      await client.query("UPDATE batch_preparations SET lease_token=NULL,lease_until=NULL,last_error=NULL WHERE batch_id=$1", [id]);
      await audit("batch_prepared", null, { batchId: id, pdfSha256: sha, signatureKind: signed.kind, snapshotSha256: row.snapshot_sha256, ...creationData(claim.frozen.source) }, client);
      if (recovery) await audit("batch_preparation_recovered", null, { batchId: id, snapshotSha256: row.snapshot_sha256, ...creationData(source) }, client);
      return { ok: true as const };
    });
  } catch (error) {
    // Release only our lease; a late worker must never clear a newer attempt.
    await query("UPDATE batch_preparations SET lease_token=NULL,lease_until=NULL,last_error='prepare_failed' WHERE batch_id=$1 AND lease_token=$2", [id, token]);
    throw error;
  }
}

/** Manual recovery prepares only; it never notifies, requests approval or sends a batch. */
export async function recoverBatchPreparation(id: number, actor: BatchActor) {
  if (!Number.isInteger(id) || id <= 0 || id > 2147483647) return { ok: false as const, error: "parameters" };
  try { return await prepareReservedBatch(id, { kind: "admin", actor }, true); }
  catch { return { ok: false as const, error: "unavailable" }; }
}

async function notifyApprover(id: number) {
  const b = await getBatch(id);
  const to = config.approverEmail();
  if (!b || !to) return;
  await sendMail({
    to,
    subject: `Lote ${b.seq} da petição pronto para aprovação`,
    text:
      `O lote ${b.seq} (${b.kind === "final" ? "FINAL" : "parcial"}) está pronto: ${b.n_servidor} servidores, ${b.n_apoiador} apoiadores e ${b.n_estrangeiro} estrangeiros.\n` +
      `Assinatura: ${b.signature_kind === "icp-brasil" ? "ICP-Brasil" : "NÃO ASSINADO (teste)"}\nsha256 do PDF: ${b.pdf_sha256}\n\n` +
      `Para revisar e aprovar o envio, acesse: ${config.appUrl()}/admin/lotes\n(o envio exige senha do painel e um código enviado a este e-mail)`,
  }, "aprovacao");
}

/** Chamado após cada confirmação e pelo agendador. */
export async function tick(now = new Date()): Promise<{ created: number[] }> {
  const created: number[] = [];
  await purgeOldEvents().catch(() => {}); // retenção dos registros de acesso
  if (now >= config.finalAt()) {
    const f = await createBatch("final");
    if (f) created.push(f.id);
  }
  while (true) {
    const b = await createBatch("partial");
    if (!b) break;
    created.push(b.id);
  }
  return { created };
}

// --- aprovação em duas etapas: senha do painel + código de 6 dígitos enviado ao aprovador ---

export type ApprovalRow = Batch & { pdf: Buffer | null; signed_pdf: Buffer | null; signed_pdf_sha256: string | null; approval_code_hash: string | null; approval_code_expires_at: string | null; approval_attempts: number };
/** Bind approval to the exact bytes and classification, without rewriting published data. */
const pdfDigest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const documentVersion = (b: ApprovalRow) => sha256(JSON.stringify([b.id, b.seq, b.kind, b.n_servidor, b.n_apoiador, b.n_estrangeiro, b.list_hash, b.pdf_sha256, b.signed_pdf_sha256, b.signature_kind, b.pdf && pdfDigest(b.pdf), b.signed_pdf && pdfDigest(b.signed_pdf)]));
export const batchMessageKey = (id: number, sha: string, to: string) => `batch-send:v1:${id}:${sha}:${hmac(to)}`;
/** Shared exact envelope for transport and metadata-only reconciliation. */
export function batchEnvelope(row: ApprovalRow, to: string, pdf: Buffer, sentSha: string): Mail {
  return {
        to,
        subject: `Petição pela sanção integral do PLV nº 12/2026 - lote ${row.seq}${row.kind === "final" ? " (final)" : ""}`,
        text:
          `Excelentíssimas autoridades,\n\nEncaminhamos, em anexo, a lista de apoiadores da petição pela sanção integral do PLV nº 12/2026 (lote ${row.seq}): ` +
          `${row.n_servidor} servidores de Instituições Federais de Ensino, ${row.n_apoiador} apoiadores da sociedade civil${row.n_estrangeiro ? ` e ${row.n_estrangeiro} professores, técnicos e acadêmicos de universidades do exterior` : ""}.\n\n` +
          `${row.signature_kind === "icp-brasil" ? "Documento assinado digitalmente (ICP-Brasil) pela" : "Versão de TESTE, sem assinatura digital válida, da"} ADUNIR – Seção Sindical do ANDES-SN (CNPJ 15.883.671/0001-15). sha256 do PDF: ${sentSha}\n\n` +
          `Respeitosamente,\nADUNIR – Seção Sindical do ANDES-SN`,
        attachments: [{ filename: `peticao-plv12-2026-lote-${row.seq}${row.signed_pdf ? "-assinado" : ""}.pdf`, content: pdf, contentType: "application/pdf" }],
      };
}

const approvalHash = (b: ApprovalRow, code: string, binding: DeliveryBinding | null = null) => binding
  ? hmac(`code:v3:${b.id}:${documentVersion(b)}:${binding.packageId}:${binding.packageDigest}:${code}`)
  : hmac(`code:v2:${b.id}:${documentVersion(b)}:${code}`);
async function deliveryForApprovalTx(client: PoolClient, row: ApprovalRow) {
  if (!row.approved_at) return pendingBatchDeliveryTx(client, row);
  const records = (await client.query<{ data: string }>("SELECT data FROM audit_log WHERE event='batch_approved' AND data::jsonb->>'batchId'=$1 ORDER BY id LIMIT 2", [String(row.id)])).rows;
  if (records.length !== 1) return null;
  let stored; try { stored = JSON.parse(records[0].data); } catch { return null; }
  return resolveBatchDeliveryTx(client, row, stored);
}
async function mayApprovePacketTx(client: PoolClient, actor: BatchActor, binding: DeliveryBinding | null) {
  if (!binding) return true;
  return !!actor.sessaoId && !!(await client.query("SELECT 1 FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>clock_timestamp() AND stepup_ate>clock_timestamp() FOR SHARE", [actor.sessaoId, actor.userId])).rowCount
    && await batchPackageDispatchReadyTx(client, binding.packageId);
}

export async function requestApprovalCode(id: number, actor: BatchActor): Promise<void> {
  const to = config.approverEmail();
  if (!to) throw new Error("APPROVER_EMAIL não configurado.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const b = await tx(async client => {
    if (!(await authorizeBatchActor(client, actor))) throw new Error("Lote não está pronto para aprovação.");
    const row = (await client.query<ApprovalRow>("SELECT * FROM batches WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row?.pdf) throw new Error("Lote não está pronto para aprovação.");
    const retry = row.approved_at ? await rejectedBatchRecipients(client, row) : null;
    if (row.approved_at ? !retry : row.status !== "prepared") throw new Error("Lote não está pronto para aprovação.");
    const delivery = await deliveryForApprovalTx(client, row);
    if (!delivery || !await mayApprovePacketTx(client, actor, delivery.binding)) throw new Error("Lote não está pronto para aprovação.");
    const codeHash = approvalHash(row, code, delivery.binding);
    await client.query("UPDATE batches SET approval_code_hash=$1, approval_code_expires_at=$2, approval_attempts=0 WHERE id=$3", [codeHash, new Date(Date.now() + 15 * 60_000).toISOString(), id]);
    await audit(retry ? "batch_retry_code_prepared" : "approval_code_prepared", null, { batchId: id, documentVersion: documentVersion(row), approvalCodeHash: codeHash, ...(delivery.binding ?? {}), ...(retry ? { recipients: retry } : {}), ...actorData(actor) }, client);
    return { row, codeHash };
  });
  await sendNow({ to, subject: `Código para aprovar o lote ${b.row.seq}: ${code}`, text: `Código de aprovação do lote ${b.row.seq}: ${code}\nVale por 15 minutos. Se não foi você, ignore.` }, "aprovacao", `batch-code:${id}:${b.codeHash}`);
  await audit("approval_code_sent", null, { batchId: id, ...actorData(actor) });
}

export type ApproveResult = { ok: true; sent: number; failed: number } | { ok: false; reason: string };

export async function approveAndSend(id: number, code: string, approvedBy: string, actor: BatchActor): Promise<ApproveResult> {
  const admission = await tx<{ ok: false; reason: string } | { ok: true; row: ApprovalRow; sentSha: string; recipients: string[]; delivery: NonNullable<Awaited<ReturnType<typeof resolveBatchDeliveryTx>>> }>(async client => {
    if (!(await authorizeBatchActor(client, actor))) return { ok: false, reason: "Lote não está disponível para envio." };
    if (((await client.query<{ value: string }>("SELECT value FROM settings WHERE key='sending_enabled'")).rows[0]?.value ?? "true") !== "true") return { ok: false as const, reason: "Envios estão pausados." };
    const row = (await client.query<ApprovalRow>("SELECT * FROM batches WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!row?.pdf || (row.status !== "prepared" && row.status !== "failed")) return { ok: false as const, reason: "Lote não está disponível para envio." };
    const retry = row.approved_at ? await rejectedBatchRecipients(client, row) : null;
    if (row.approved_at && !retry) return { ok: false, reason: "Lote não está disponível para envio." };
    try { assertSendable(row.signature_kind); } catch (e) { return { ok: false, reason: (e as Error).message }; }
    if (!row.approval_code_hash || !row.approval_code_expires_at || new Date(row.approval_code_expires_at) < new Date()) return { ok: false, reason: "Solicite um novo código." };
    if (row.approval_attempts >= 5) return { ok: false, reason: "Muitas tentativas. Solicite um novo código." };
    const delivery = await deliveryForApprovalTx(client, row);
    if (!delivery || !await mayApprovePacketTx(client, actor, delivery.binding)) return { ok: false, reason: "Lote não está disponível para envio." };
    if (!safeEqual(row.approval_code_hash, approvalHash(row, code.trim(), delivery.binding))) {
      await client.query("UPDATE batches SET approval_attempts = approval_attempts + 1 WHERE id=$1", [id]);
      await audit("approval_code_wrong", null, { batchId: id, ...actorData(actor) }, client);
      return { ok: false, reason: "Código incorreto." };
    }
    const recipients = retry ?? [...new Set(config.recipients().map(to => to.trim().toLowerCase()))];
    if (recipients.length === 0) return { ok: false, reason: "Nenhum destinatário configurado (RECIPIENTS)." };

    const pdf = row.signed_pdf ?? row.pdf;
    const sentSha = pdfDigest(pdf);
    if (sentSha !== delivery.sentSha || sentSha !== (row.signed_pdf ? row.signed_pdf_sha256 : row.pdf_sha256)) return { ok: false as const, reason: "Lote não está disponível para envio." };
    if (retry) {
      // Prepared plus an existing approval is the in-flight latch; no new code while sending.
      await client.query("UPDATE batches SET status='prepared',approval_code_hash=NULL WHERE id=$1", [id]);
    } else await client.query("UPDATE batches SET approved_by=$1, approved_at=$2, approval_code_hash=NULL WHERE id=$3", [approvedBy, new Date().toISOString(), id]);
    await audit(retry ? "batch_retry_approved" : "batch_approved", null, { batchId: id, approvedBy, documentVersion: documentVersion(row), sentSha256: sentSha, recipients, ...(delivery.binding ?? {}), ...actorData(actor) }, client);
    return { ok: true as const, row, sentSha, recipients, delivery };
  });
  if (!admission.ok) return { ok: false, reason: admission.reason };
  // No database transaction spans transport. Consumed approval freezes the document.
  const { recipients, delivery } = admission;

  const done = new Set((await query<{ recipient: string }>("SELECT recipient FROM batch_sends WHERE batch_id=$1 AND ok", [id])).rows.map((r) => r.recipient));
  let sent = 0, failed = 0;
  for (const to of recipients) {
    if (done.has(to)) continue;
    let error: unknown;
    try {
      if (!(await sendingEnabled())) throw new Error("envios pausados durante o disparo");
      if (delivery.binding && !await tx(async client => await authorizeBatchActor(client, actor) && await mayApprovePacketTx(client, actor, delivery.binding))) throw new Error("Lote não está disponível para envio.");
      const { key, envelope } = delivery.message(to);
      const original = (await query<{ reply_to: string | null }>("SELECT reply_to FROM mail_messages WHERE request_key=$1", [hmac("mail-request-v1:" + key)])).rows[0];
      await sendNow(original ? frozenReplyTo(envelope, original.reply_to) : withReplyTo(envelope), "lote", key, true);
    } catch (e) {
      error = e;
    }
    // A failed persistence after acceptance must never become a false rejection.
    await tx(async client => {
      await client.query("INSERT INTO batch_sends(batch_id,recipient,ok,error,at) VALUES($1,$2,$3,$4,$5) ON CONFLICT (batch_id,recipient) DO UPDATE SET ok=EXCLUDED.ok,error=EXCLUDED.error,at=EXCLUDED.at WHERE NOT batch_sends.ok", [id, to, !error, error ? "transport_uncertain" : null, new Date().toISOString()]);
      await audit("batch_recipient_result", null, { batchId: id, recipient: to, accepted: !error, ...actorData(actor), ...(error ? { outcome: "uncertain_or_blocked" } : {}) }, client);
    });
    if (error) failed++; else sent++;
  }
  const status = failed === 0 ? "sent" : "failed";
  await tx(async client => {
    await client.query("UPDATE batches SET status=$1, sent_at=CASE WHEN $1='sent' THEN COALESCE(sent_at,$2) ELSE sent_at END WHERE id=$3", [status, new Date().toISOString(), id]);
    await audit("batch_send_result", null, { batchId: id, sent, failed, ...actorData(actor) }, client);
  });
  return { ok: true, sent, failed };
}

/** Anexa o PDF assinado enviado pelo responsável. Só vira "icp-brasil" se a estrutura e a cadeia forem validadas. */
export async function attachSignedPdf(id: number, bytes: Buffer, by: string, actor: BatchActor): Promise<{ ok: boolean; kind: string; notes: string[] }> {
  const unavailable = { ok: false, kind: "none", notes: ["Lote não está disponível para receber assinatura."] };
  // Do not hold a transaction while calling the validator. Recheck this revision after it.
  const row = (await query<ApprovalRow & { revision: string }>("SELECT *,xmin::text revision FROM batches WHERE id=$1", [id])).rows[0];
  if (!row?.pdf || row.approved_at || (row.status !== "prepared" && row.status !== "failed")) return unavailable;
  if (bytes.length > 25 * 1024 * 1024) return { ok: false, kind: "none", notes: ["Arquivo grande demais (máx. 25 MB)."] };
  const st = checkSignedPdf(row.pdf, bytes);
  if (!st.ok) {
    return tx(async client => {
      if (!(await authorizeBatchActor(client, actor))) return unavailable;
      await audit("signed_pdf_rejected", null, { batchId: id, by, reasons: st.reasons, ...actorData(actor) }, client);
      return { ok: false, kind: "none", notes: st.reasons };
    });
  }
  const icp = await verifyIcpBrasil(bytes);
  const kind = icp.valid ? "icp-brasil" : "externa-nao-validada";
  const notes = [`${st.signatures} assinatura(s) encontrada(s).`, icp.valid ? `Cadeia ICP-Brasil válida${icp.signer ? `: ${icp.signer}` : ""}.` : icp.reason ?? "Não validada."];
  const sha = createHash("sha256").update(bytes).digest("hex");
  return tx(async client => {
    if (!(await authorizeBatchActor(client, actor))) return unavailable;
    const current = (await client.query<ApprovalRow & { revision: string }>("SELECT *,xmin::text revision FROM batches WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!current || current.revision !== row.revision || current.approved_at || !["prepared", "failed"].includes(current.status) || documentVersion(current) !== documentVersion(row)) return unavailable;
    await preserveObservedDocument(client, { batchId:id, variant:"original", bytes:current.pdf!, sha256:current.pdf_sha256!, listHash:current.list_hash, signatureKind:null, note:null, recordedBy:actor.userId });
    if (current.signed_pdf) await preserveObservedDocument(client, { batchId:id, variant:"signed", bytes:current.signed_pdf, sha256:current.signed_pdf_sha256!, listHash:current.list_hash, signatureKind:current.signature_kind, note:current.signed_note ?? null, recordedBy:actor.userId });
    await appendDocumentVersion(client, { batchId:id, variant:"signed", bytes, sha256:sha, listHash:current.list_hash, signatureKind:kind, note:notes.join(" "), source:"upload", authorId:actor.userId, recordedBy:actor.userId });
    await client.query("UPDATE batches SET signed_pdf=$1, signed_pdf_sha256=$2, signed_note=$3, signature_kind=$4, approval_code_hash=NULL WHERE id=$5", [bytes, sha, notes.join(" "), kind, id]);
    await audit("signed_pdf_attached", null, { batchId: id, by, kind, sha256: sha, ...actorData(actor) }, client);
    return { ok: true, kind, notes };
  });
}

export async function cancelBatch(id: number, actor: BatchActor): Promise<boolean> {
  return tx(async client => {
    if (!(await authorizeBatchActor(client, actor))) return false;
    const r = await client.query("UPDATE batches SET status='cancelled', approval_code_hash=NULL WHERE id=$1 AND status IN ('prepared','failed') AND approved_at IS NULL", [id]);
    if (r.rowCount) await audit("batch_cancelled", null, { batchId: id, ...actorData(actor) }, client);
    return !!r.rowCount;
  });
}
