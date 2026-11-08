import { createHash, randomInt } from "node:crypto";
import { config } from "./config";
import { audit, query, tx } from "./db";
import { buildBatchPdf, ListRow } from "./pdf";
import { assertSendable, signPdf, signerNote } from "./signer";
import { hmac, safeEqual, sha256 } from "./security";
import { sendMail } from "./mail";
import type { Mail } from "./mail";
/** Envios que o admin acompanha (código de aprovação, entrega às autoridades): se falharem, o erro aparece na hora e nada vai para a fila. */
const sendNow = (m: Mail, kind = "lote") => sendMail(m, kind, { queue: false });
import { purgeOldEvents } from "./track";
import { checkSignedPdf, verifyIcpBrasil } from "./signed-pdf";

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
export async function createBatch(kind: "partial" | "final"): Promise<Batch | null> {
  const created = await tx(async (c) => {
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
    await c.query("UPDATE signatures SET batch_id=$1 WHERE status='confirmed' AND batch_id IS NULL", [id]);
    await audit("batch_created", null, { batchId: id, seq, kind, n: rows.length, listHash }, c);
    return { id, seq, rows, nS, nE, listHash };
  });
  if (!created) return null;

  const { id, seq, rows, nS, nE, listHash } = created;
  try {
    const unsigned = await buildBatchPdf(rows, { seq, kind, generatedAt: new Date().toISOString(), listHash, nServidor: nS, nApoiador: rows.length - nS - nE, nEstrangeiro: nE, signedNote: signerNote(), origin: config.appUrl(), ...badgeCounts(rows) });
    const signed = await signPdf(unsigned);
    const sha = createHash("sha256").update(signed.bytes).digest("hex"); // hash dos bytes do arquivo, igual ao `sha256sum`
    await query("UPDATE batches SET pdf=$1, pdf_sha256=$2, signature_kind=$3, status='prepared' WHERE id=$4", [Buffer.from(signed.bytes), sha, signed.kind, id]);
    await audit("batch_prepared", null, { batchId: id, pdfSha256: sha, signatureKind: signed.kind });
  } catch (e) {
    await audit("batch_prepare_failed", null, { batchId: id, error: String(e).slice(0, 200) });
    throw e;
  }
  await notifyApprover(id).catch((e) => console.error("aviso ao aprovador falhou", e));
  return getBatch(id);
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

export async function requestApprovalCode(id: number): Promise<void> {
  const b = await getBatch(id);
  const to = config.approverEmail();
  if (!b || b.status !== "prepared") throw new Error("Lote não está pronto para aprovação.");
  if (!to) throw new Error("APPROVER_EMAIL não configurado.");
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  await query("UPDATE batches SET approval_code_hash=$1, approval_code_expires_at=$2, approval_attempts=0 WHERE id=$3", [
    hmac(`code:${id}:${code}`), new Date(Date.now() + 15 * 60_000).toISOString(), id,
  ]);
  await sendNow({ to, subject: `Código para aprovar o lote ${b.seq}: ${code}`, text: `Código de aprovação do lote ${b.seq}: ${code}\nVale por 15 minutos. Se não foi você, ignore.` }, "aprovacao");
  await audit("approval_code_sent", null, { batchId: id });
}

export type ApproveResult = { ok: true; sent: number; failed: number } | { ok: false; reason: string };

export async function approveAndSend(id: number, code: string, approvedBy: string): Promise<ApproveResult> {
  if (!(await sendingEnabled())) return { ok: false, reason: "Envios estão pausados." };
  const row = (await query<{ approval_code_hash: string | null; approval_code_expires_at: string | null; approval_attempts: number; status: string; signature_kind: string | null; seq: number; kind: string; n_servidor: number; n_apoiador: number; n_estrangeiro: number; pdf_sha256: string | null; list_hash: string }>(
    "SELECT approval_code_hash,approval_code_expires_at,approval_attempts,status,signature_kind,seq,kind,n_servidor,n_apoiador,n_estrangeiro,pdf_sha256,list_hash FROM batches WHERE id=$1", [id])).rows[0];
  if (!row || (row.status !== "prepared" && row.status !== "failed")) return { ok: false, reason: "Lote não está disponível para envio." };
  try { assertSendable(row.signature_kind); } catch (e) { return { ok: false, reason: (e as Error).message }; }
  if (!row.approval_code_hash || !row.approval_code_expires_at || new Date(row.approval_code_expires_at) < new Date()) return { ok: false, reason: "Solicite um novo código." };
  if (row.approval_attempts >= 5) return { ok: false, reason: "Muitas tentativas. Solicite um novo código." };
  if (!safeEqual(row.approval_code_hash, hmac(`code:${id}:${code.trim()}`))) {
    await query("UPDATE batches SET approval_attempts = approval_attempts + 1 WHERE id=$1", [id]);
    await audit("approval_code_wrong", null, { batchId: id });
    return { ok: false, reason: "Código incorreto." };
  }
  const recipients = config.recipients();
  if (recipients.length === 0) return { ok: false, reason: "Nenhum destinatário configurado (RECIPIENTS)." };

  await query("UPDATE batches SET approved_by=$1, approved_at=$2, approval_code_hash=NULL WHERE id=$3", [approvedBy, new Date().toISOString(), id]);
  await audit("batch_approved", null, { batchId: id, approvedBy });

  const pr = (await query<{ pdf: Buffer; signed_pdf: Buffer | null; signed_pdf_sha256: string | null }>("SELECT pdf,signed_pdf,signed_pdf_sha256 FROM batches WHERE id=$1", [id])).rows[0];
  const pdf = pr.signed_pdf ?? pr.pdf;
  const sentSha = pr.signed_pdf ? pr.signed_pdf_sha256 : row.pdf_sha256;
  const done = new Set((await query<{ recipient: string }>("SELECT recipient FROM batch_sends WHERE batch_id=$1 AND ok", [id])).rows.map((r) => r.recipient));
  let sent = 0, failed = 0;
  for (const to of recipients) {
    if (done.has(to)) continue;
    try {
      if (!(await sendingEnabled())) throw new Error("envios pausados durante o disparo");
      await sendNow({
        to,
        subject: `Petição pela sanção integral do PLV nº 12/2026 - lote ${row.seq}${row.kind === "final" ? " (final)" : ""}`,
        text:
          `Excelentíssimas autoridades,\n\nEncaminhamos, em anexo, a lista de apoiadores da petição pela sanção integral do PLV nº 12/2026 (lote ${row.seq}): ` +
          `${row.n_servidor} servidores de Instituições Federais de Ensino, ${row.n_apoiador} apoiadores da sociedade civil${row.n_estrangeiro ? ` e ${row.n_estrangeiro} professores, técnicos e acadêmicos de universidades do exterior` : ""}.\n\n` +
          `${row.signature_kind === "icp-brasil" ? "Documento assinado digitalmente (ICP-Brasil) pela" : "Versão de TESTE, sem assinatura digital válida, da"} ADUNIR – Seção Sindical do ANDES-SN (CNPJ 15.883.671/0001-15). sha256 do PDF: ${sentSha}\n\n` +
          `Respeitosamente,\nADUNIR – Seção Sindical do ANDES-SN`,
        attachments: [{ filename: `peticao-plv12-2026-lote-${row.seq}${pr.signed_pdf ? "-assinado" : ""}.pdf`, content: pdf, contentType: "application/pdf" }],
      });
      await query("INSERT INTO batch_sends(batch_id,recipient,ok,at) VALUES($1,$2,true,$3) ON CONFLICT (batch_id,recipient) DO UPDATE SET ok=true,error=NULL,at=EXCLUDED.at", [id, to, new Date().toISOString()]);
      sent++;
    } catch (e) {
      await query("INSERT INTO batch_sends(batch_id,recipient,ok,error,at) VALUES($1,$2,false,$3,$4) ON CONFLICT (batch_id,recipient) DO UPDATE SET ok=false,error=EXCLUDED.error,at=EXCLUDED.at", [id, to, String(e).slice(0, 200), new Date().toISOString()]);
      failed++;
    }
  }
  const status = failed === 0 ? "sent" : "failed";
  await query("UPDATE batches SET status=$1, sent_at=CASE WHEN $1='sent' THEN $2 ELSE sent_at END WHERE id=$3", [status, new Date().toISOString(), id]);
  await audit("batch_send_result", null, { batchId: id, sent, failed });
  return { ok: true, sent, failed };
}

/** Anexa o PDF assinado enviado pelo responsável. Só vira "icp-brasil" se a estrutura e a cadeia forem validadas. */
export async function attachSignedPdf(id: number, bytes: Buffer, by: string): Promise<{ ok: boolean; kind: string; notes: string[] }> {
  const row = (await query<{ pdf: Buffer | null; status: string }>("SELECT pdf,status FROM batches WHERE id=$1", [id])).rows[0];
  if (!row?.pdf || (row.status !== "prepared" && row.status !== "failed")) return { ok: false, kind: "none", notes: ["Lote não está disponível para receber assinatura."] };
  if (bytes.length > 25 * 1024 * 1024) return { ok: false, kind: "none", notes: ["Arquivo grande demais (máx. 25 MB)."] };
  const st = checkSignedPdf(row.pdf, bytes);
  if (!st.ok) { await audit("signed_pdf_rejected", null, { batchId: id, by, reasons: st.reasons }); return { ok: false, kind: "none", notes: st.reasons }; }
  const icp = await verifyIcpBrasil(bytes);
  const kind = icp.valid ? "icp-brasil" : "externa-nao-validada";
  const notes = [`${st.signatures} assinatura(s) encontrada(s).`, icp.valid ? `Cadeia ICP-Brasil válida${icp.signer ? `: ${icp.signer}` : ""}.` : icp.reason ?? "Não validada."];
  const sha = createHash("sha256").update(bytes).digest("hex");
  await query("UPDATE batches SET signed_pdf=$1, signed_pdf_sha256=$2, signed_note=$3, signature_kind=$4, approval_code_hash=NULL WHERE id=$5", [bytes, sha, notes.join(" "), kind, id]);
  await audit("signed_pdf_attached", null, { batchId: id, by, kind, sha256: sha });
  return { ok: true, kind, notes };
}

export async function cancelBatch(id: number): Promise<boolean> {
  return tx(async client => {
    const r = await client.query("UPDATE batches SET status='cancelled', approval_code_hash=NULL WHERE id=$1 AND status IN ('prepared','failed')", [id]);
    if (r.rowCount) await audit("batch_cancelled", null, { batchId: id }, client);
    return !!r.rowCount;
  });
}
