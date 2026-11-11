export type Signed = { bytes: Uint8Array; kind: "none" | "icp-brasil"; note: string };

/**
 * Assinatura do dossiê. Hoje só existe o modo "none" (PDF de TESTE, sem valor jurídico).
 * O modo "icp" (e-CNPJ da ADUNIR + carimbo do tempo) depende do tipo do certificado (A1/A3/nuvem).
 */
export async function signPdf(pdf: Uint8Array): Promise<Signed> {
  const mode = process.env.SIGNER ?? "none";
  if (mode === "none") return { bytes: pdf, kind: "none", note: "NAO ASSINADO (teste)" };
  throw new Error(`Assinador "${mode}" ainda não implementado`);
}

/** Em produção, só PDF assinado com ICP-Brasil pode sair. */
export function assertSendable(kind: string | null, nodeEnv: string | undefined = process.env.NODE_ENV): void {
  if (nodeEnv === "production" && process.env.PREVIEW_MODE !== "1" && kind !== "icp-brasil") {
    throw new Error("Envio bloqueado: o lote não está assinado com certificado ICP-Brasil.");
  }
}

/** Texto do rodapé do PDF, conhecido antes de assinar. */
export const signerNote = (preparation?: "a1") => preparation === "a1" ? "" : ((process.env.SIGNER ?? "none") === "none" ? "NAO ASSINADO (teste)" : "assinado ICP-Brasil");
