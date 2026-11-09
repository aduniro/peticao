import { readLimitedText } from "./http-body";

/**
 * PDF assinado pelo responsável (e-CNPJ da ADUNIR, no Adobe/LibreOffice/Assinador do ITI) e reenviado ao site.
 * Verificações ESTRUTURAIS locais abaixo. A validação criptográfica da cadeia ICP-Brasil é um serviço plugável
 * (ICP_VALIDATOR_URL, ex.: um pequeno serviço com pyHanko e as raízes do ITI). Sem ele, o lote NUNCA fica "icp-brasil"
 * e, em produção, o envio permanece bloqueado.
 */
export type StructCheck = { ok: boolean; reasons: string[]; signatures: number };

const SUBFILTERS = ["adbe.pkcs7.detached", "ETSI.CAdES.detached", "adbe.pkcs7.sha1"];

export function checkSignedPdf(original: Buffer, uploaded: Buffer): StructCheck {
  const reasons: string[] = [];
  if (uploaded.subarray(0, 5).toString() !== "%PDF-") reasons.push("O arquivo não é um PDF.");
  // Assinaturas padrão (PAdES) são acrescentadas ao final: os bytes originais do lote ficam intactos no início.
  if (uploaded.length <= original.length || !uploaded.subarray(0, original.length).equals(original)) {
    reasons.push("O PDF assinado não contém o documento original do lote (não é o mesmo arquivo, ou foi regravado em vez de assinado).");
  }
  const text = uploaded.toString("latin1");
  const ranges = [...text.matchAll(/\/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]/g)];
  if (ranges.length === 0) reasons.push("Nenhuma assinatura digital encontrada no PDF.");
  else {
    const last = ranges[ranges.length - 1];
    const [a, , c, d] = [Number(last[1]), Number(last[2]), Number(last[3]), Number(last[4])];
    if (a !== 0 || c + d !== uploaded.length) reasons.push("A última assinatura não cobre o documento inteiro (houve alteração depois de assinar?).");
  }
  if (!/\/Type\s*\/Sig\b/.test(text)) reasons.push("Não há dicionário de assinatura (/Type /Sig).");
  if (!SUBFILTERS.some((s) => text.includes(s))) reasons.push("Formato de assinatura não reconhecido (esperado PAdES/CAdES destacado).");
  return { ok: reasons.length === 0, reasons, signatures: ranges.length };
}

export type IcpResult = { valid: boolean; signer?: string; reason?: string; code?: "validator_response_invalid" | "validator_identity_missing" | "validator_expected_identity_invalid" };
const INVALID_RESPONSE = "Assinatura inválida segundo o validador.";
const MAX_VALIDATOR_RESPONSE_BYTES = 64 * 1024;
function normalizedCnpj(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  return /^(?:[0-9]{14}|[0-9]{2}\.[0-9]{3}\.[0-9]{3}\/[0-9]{4}-[0-9]{2})$/.test(text) ? text.replace(/\D/g, "") : null;
}

/** Valida a cadeia ICP-Brasil num serviço externo. POST application/pdf → { valid, signer?, cnpj? }. */
export async function verifyIcpBrasil(pdf: Buffer, fetchImpl: typeof fetch = fetch): Promise<IcpResult> {
  const url = process.env.ICP_VALIDATOR_URL;
  if (!url) return { valid: false, reason: "Validador ICP-Brasil não configurado (ICP_VALIDATOR_URL): a assinatura não foi verificada criptograficamente." };
  try {
    const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/pdf", ...(process.env.ICP_VALIDATOR_TOKEN ? { authorization: `Bearer ${process.env.ICP_VALIDATOR_TOKEN}` } : {}) }, body: new Uint8Array(pdf), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return { valid: false, reason: `Validador respondeu ${r.status}.` };
    const body = await readLimitedText(r, MAX_VALIDATOR_RESPONSE_BYTES);
    if (!body.ok) return { valid: false, reason: INVALID_RESPONSE, code: "validator_response_invalid" };
    let parsed: unknown;
    try { parsed = JSON.parse(body.raw); } catch { return { valid: false, reason: INVALID_RESPONSE, code: "validator_response_invalid" }; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { valid: false, reason: INVALID_RESPONSE, code: "validator_response_invalid" };
    const j = parsed as Record<string, unknown>;
    if (typeof j.valid !== "boolean" || Object.hasOwn(j, "signer") && (typeof j.signer !== "string" || j.signer.length > 500 || /[\u0000-\u001f\u007f]/.test(j.signer)) || Object.hasOwn(j, "cnpj") && normalizedCnpj(j.cnpj) === null) return { valid: false, reason: INVALID_RESPONSE, code: "validator_response_invalid" };
    if (j.valid !== true) return { valid: false, signer: j.signer as string | undefined, reason: INVALID_RESPONSE };
    // A1 e-CNPJ ADUNIR was explicitly confirmed by the owner on 09/11/2026.
    // A positive adapter verdict without the holder identity is insufficient.
    if (!Object.hasOwn(j, "cnpj")) return { valid: false, reason: INVALID_RESPONSE, code: "validator_identity_missing" };
    const want = normalizedCnpj(process.env.ICP_EXPECTED_CNPJ ?? "15883671000115");
    if (!want) return { valid: false, reason: INVALID_RESPONSE, code: "validator_expected_identity_invalid" };
    if (normalizedCnpj(j.cnpj) !== want) return { valid: false, reason: "A assinatura é válida, mas não é do e-CNPJ da ADUNIR." };
    return { valid: true, signer: j.signer as string | undefined, reason: undefined };
  } catch {
    return { valid: false, reason: "Validador ICP-Brasil indisponível." };
  }
}
