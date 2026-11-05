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

export type IcpResult = { valid: boolean; signer?: string; reason?: string };

/** Valida a cadeia ICP-Brasil num serviço externo. POST application/pdf → { valid, signer?, cnpj? }. */
export async function verifyIcpBrasil(pdf: Buffer, fetchImpl: typeof fetch = fetch): Promise<IcpResult> {
  const url = process.env.ICP_VALIDATOR_URL;
  if (!url) return { valid: false, reason: "Validador ICP-Brasil não configurado (ICP_VALIDATOR_URL): a assinatura não foi verificada criptograficamente." };
  try {
    const r = await fetchImpl(url, { method: "POST", headers: { "content-type": "application/pdf", ...(process.env.ICP_VALIDATOR_TOKEN ? { authorization: `Bearer ${process.env.ICP_VALIDATOR_TOKEN}` } : {}) }, body: new Uint8Array(pdf), signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return { valid: false, reason: `Validador respondeu ${r.status}.` };
    const j = (await r.json()) as { valid?: boolean; signer?: string; cnpj?: string };
    const want = (process.env.ICP_EXPECTED_CNPJ ?? "15883671000115").replace(/\D/g, ""); // CNPJ da ADUNIR
    if (j.valid && j.cnpj && j.cnpj.replace(/\D/g, "") !== want) return { valid: false, reason: "A assinatura é válida, mas não é do e-CNPJ da ADUNIR." };
    return { valid: !!j.valid, signer: j.signer, reason: j.valid ? undefined : "Assinatura inválida segundo o validador." };
  } catch {
    return { valid: false, reason: "Validador ICP-Brasil indisponível." };
  }
}
