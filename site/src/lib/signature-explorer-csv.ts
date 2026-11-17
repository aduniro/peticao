import { createHash } from "node:crypto";
import { esc } from "./csv";
import type { SignatureExplorerLine } from "./signature-explorer-admin-contract";
export const SIGNATURE_EXPLORER_CSV_HEADERS = ["Nome", "Categoria", "Instituição", "Cargo", "Amazônia Legal/Fronteira", "Campus", "Cidade/UF", "País", "Status", "Criada em", "Confirmada em"] as const;
/** Same 11 columns, encoding, dates and ordering as the existing download; every matched row, never a hidden cap. */
export function buildSignatureExplorerCsv(rows: readonly SignatureExplorerLine[], expectedTotal: number) {
  if (!Number.isSafeInteger(expectedTotal) || expectedTotal < 0 || rows.length !== expectedTotal) throw new Error("incomplete_signature_export");
  const ids = new Set<number>(), parts = [Buffer.from("\uFEFF" + SIGNATURE_EXPLORER_CSV_HEADERS.map(esc).join(","), "utf8")];
  let bytes = parts[0].length;
  for (const row of rows) {
    if (!Number.isInteger(row.id) || row.id < 1 || ids.has(row.id)) throw new Error("invalid_signature_export_id"); ids.add(row.id);
    const cells = [row.nome, row.categoria, row.instituicao, row.cargo, row.regiao, row.campus, row.cidadeUf, row.pais, row.status, row.criada, row.confirmada];
    const part = Buffer.from("\r\n" + cells.map(esc).join(","), "utf8"); bytes += part.length;
    if (bytes > 128 * 1024 * 1024) throw new Error("signature_export_budget"); parts.push(part);
  }
  const body = Buffer.concat(parts, bytes);
  if (ids.size !== expectedTotal || body.length !== bytes) throw new Error("incomplete_signature_export");
  return { body, bytes, rows: expectedTotal, sha256: createHash("sha256").update(body).digest("hex") };
}
