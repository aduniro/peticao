import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFArray, PDFDict, PDFDocument, PDFName, PDFStream, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { freezeOwnConfirmation, type OwnConfirmationSnapshot } from "./president-native-contract";

/** Wrap long names/identifiers without losing Unicode code points or exceeding the line width. */
export function wrapPresidentText(value: string, maximum: number, measure: (text: string) => number) {
  if (!Number.isFinite(maximum) || maximum <= 0) throw new Error("invalid_confirmation_layout");
  const lines: string[] = [];
  let line = "";
  for (const word of value.trim().split(/\s+/).filter(Boolean)) {
    const candidate = line ? `${line} ${word}` : word;
    if (measure(candidate) <= maximum) { line = candidate; continue; }
    if (line) { lines.push(line); line = ""; }
    for (const character of Array.from(word)) {
      if (measure(character) > maximum) throw new Error("invalid_confirmation_layout");
      if (line && measure(line + character) > maximum) { lines.push(line); line = ""; }
      line += character;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/** Rendering only. The caller must obtain the snapshot from a consumed server receipt,
 * reauthorize after rendering and persist with a document/profile CAS. */
export async function renderPresidentConfirmation(source: Buffer, snapshot: OwnConfirmationSnapshot) {
  const frozen = freezeOwnConfirmation(snapshot, source);
  if (!frozen.ok) throw new Error("invalid_own_confirmation");
  // Use only the frozen primitive snapshot after validation (including across awaits).
  const confirmed = frozen.snapshot;
  const input = Buffer.from(source);
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  if (doc.getPageCount() < 1 || doc.getPageCount() > 1000) throw new Error("invalid_own_confirmation_pdf");
  // Inspect direct and indirect dictionaries, including arrays and stream dictionaries.
  // Rewriting even an indirectly nested signature would invalidate its original bytes.
  const stack: unknown[] = doc.context.enumerateIndirectObjects().map(([, value]) => value);
  const seen = new Set<unknown>();
  while (stack.length) {
    const value = stack.pop();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    if (seen.size > 200_000) throw new Error("invalid_own_confirmation_pdf");
    if (value instanceof PDFDict) {
      const type = doc.context.lookup(value.get(PDFName.of("Type"))), field = doc.context.lookup(value.get(PDFName.of("FT")));
      if (value.has(PDFName.of("ByteRange")) || type instanceof PDFName && type.decodeText() === "Sig" || field instanceof PDFName && field.decodeText() === "Sig") throw new Error("already_signed_pdf");
      stack.push(...value.values());
    } else if (value instanceof PDFArray) stack.push(...value.asArray());
    else if (value instanceof PDFStream) stack.push(value.dict);
  }
  doc.registerFontkit(fontkit);
  const font = await doc.embedFont(readFileSync(join(process.cwd(), "assets/fonts/NotoSans-Regular.ttf")), { subset: true });
  const bold = await doc.embedFont(readFileSync(join(process.cwd(), "assets/fonts/NotoSans-SemiBold.ttf")), { subset: true });
  const page = doc.addPage([595.28, 841.89]);
  const ink = rgb(.1, .17, .14), green = rgb(5 / 255, 56 / 255, 42 / 255), gray = rgb(.37, .43, .4);
  let y = 780;
  function text(value: string, size = 11, strong = false, color = ink) {
    const f = strong ? bold : font;
    const characterSet = new Set(f.getCharacterSet());
    if (Array.from(value).some(character => !characterSet.has(character.codePointAt(0)!))) throw new Error("unsupported_confirmation_glyph");
    for (const line of wrapPresidentText(value, 507, candidate => f.widthOfTextAtSize(candidate, size))) {
      if (y < 64) throw new Error("confirmation_layout_overflow");
      page.drawText(line, { x: 44, y, size, font: f, color });
      y -= size * 1.55;
    }
  }
  text("ADUNIR", 23, true, green);
  text("Seção Sindical do ANDES-SN", 11, false, gray); y -= 20;
  text("Confirmação do responsável", 19, true, green); y -= 24;
  const when = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(new Date(confirmed.confirmedAt));
  for (const [label, value] of [
    ["Responsável", confirmed.signerName],
    ["Instituição", "ADUNIR - Seção Sindical do ANDES-SN"],
    ["Documento", `Petição PLV 12/2026 - lote ${confirmed.batchId}`],
    ["Método", "Confirmação própria do aplicativo"],
    ["Data da confirmação", `${when} (Brasília)`],
    ["Recibo", confirmed.receiptId],
  ]) { text(label, 10, true, gray); text(value, 12); y -= 12; }
  text("SHA256 do documento revisado", 10, true, gray);
  text(confirmed.sourceSha256.slice(0, 32), 10); text(confirmed.sourceSha256.slice(32), 10); y -= 20;
  text("Li o documento identificado acima e confirmo minha assinatura.", 12, true);
  page.drawText("ADUNIR - PLV 12/2026 | confirmação do responsável", { x: 44, y: 32, size: 9, font, color: gray });
  const bytes = Buffer.from(await doc.save());
  if (bytes.length > 25 * 1024 * 1024) throw new Error("own_confirmation_pdf_too_large");
  return { bytes, sourcePages: doc.getPageCount() - 1, evidenceDigest: frozen.evidenceDigest };
}
