import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PDFDocument, PDFFont, PDFImage, PDFPage, degrees, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { PETICAO, TEXT_VERSION, estrangeiroPdfPt, type Doc } from "@/content/peticao";
import { countryName } from "@/i18n";
import { brasilia } from "./time";
import { statementLine } from "./signature-text";
import { formatCode } from "./verify-code";
import { municipalityById } from "./geo-data";
import { institutionLabel } from "./ifes-data";
import { qrMatrix } from "./card";

export type ListRow = {
  name: string; category: string; role: string | null; institution: string | null; city: string | null; uf: string | null; country?: string | null; university?: string | null;
  campus?: string | null; email_domain_kind?: string | null; cpf_name_check?: string | null;
  id?: number; seq?: number | null; verify_code?: string | null; confirmed_at?: string | Date | null; region_validated?: boolean | null; campus_ibge?: number | null;
};

const GREEN = rgb(5 / 255, 56 / 255, 42 / 255), GREEN2 = rgb(11 / 255, 107 / 255, 69 / 255), YELLOW = rgb(245 / 255, 197 / 255, 24 / 255);
const INK = rgb(0.1, 0.17, 0.14), MUTED = rgb(0.36, 0.42, 0.39), LINE = rgb(0.8, 0.85, 0.82), SOFT = rgb(0.93, 0.96, 0.94), WHITE = rgb(1, 1, 1);

/**
 * Largura do texto pelas larguras dos glifos (com cache): o widthOfTextAtSize do pdf-lib refaz o layout do fontkit a cada chamada
 * (~3 ms), o que tornava o PDF lento. Sem kerning, a diferença é imperceptível nestes tamanhos.
 */
const meters = new WeakMap<PDFFont, { adv: Map<number, number>; fk: any }>();
function wid(f: PDFFont, text: string, size: number): number {
  const m = meters.get(f)!;
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    let a = m.adv.get(cp);
    if (a === undefined) { a = m.fk.glyphForCodePoint(cp).advanceWidth / m.fk.unitsPerEm; m.adv.set(cp, a); }
    w += a;
  }
  return w * size;
}
async function embed(doc: PDFDocument, file: string): Promise<PDFFont> {
  const bytes = asset("fonts", file);
  const f = await doc.embedFont(bytes, { subset: true, features: { calt: false, ccmp: false, kern: false, liga: false, locl: false, mark: false, mkmk: false, rlig: false, clig: false, dlig: false } as any });
  meters.set(f, { adv: new Map(), fk: (fontkit as any).create(bytes) });
  return f;
}

/** Troca caracteres que a fonte não tem por equivalentes legíveis (letra base sem acento) ou "?" (CJK, árabe…). */
const charsets = new WeakMap<PDFFont, Set<number>>();
export function clean(s: string, font: PDFFont): string {
  let cs = charsets.get(font);
  if (!cs) { cs = new Set(font.getCharacterSet()); charsets.set(font, cs); }
  let out = "";
  for (const ch of s.replace(/\*\*/g, "")) {
    const cp = ch.codePointAt(0)!;
    if (cp === 0xa0 || cp === 0x2009 || cp === 0x202f) { out += " "; continue; }
    if (cp < 32) continue;
    if (cs.has(cp)) { out += ch; continue; }
    const base = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
    out += [...base].every((c) => cs!.has(c.codePointAt(0)!)) ? base : "?";
  }
  return out;
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w of clean(text, font).split(/\s+/)) {
    const t = line ? `${line} ${w}` : w;
    if (wid(font, t, size) > width && line) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}
const fit = (text: string, font: PDFFont, size: number, width: number, min = 8.5) => { let s = size; const t = clean(text, font); while (s > min && wid(font, t, s) > width) s -= 0.5; return s; };
const cutTo = (text: string, font: PDFFont, size: number, width: number) => { let s = clean(text, font); while (s.length > 3 && wid(font, s, size) > width) s = s.slice(0, -2); return s; };

export type PdfMeta = { seq: number; kind: "partial" | "final"; generatedAt: string; listHash: string; nServidor: number; nApoiador: number; nEstrangeiro?: number; signedNote: string; nInstitucional?: number; nDiscente?: number; nNomeConferido?: number; origin?: string; preview?: string };

const asset = (...p: string[]) => readFileSync(join(process.cwd(), "assets", ...p));
export { institutionLabel };
const ROLE = (r: string | null | undefined) => (r === "docente" ? "Docente" : r === "tae" ? "Técnico-administrativo (TAE)" : null);

export async function buildBatchPdf(rows: ListRow[], meta: PdfMeta): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  doc.setTitle(`Petição PLV 12/2026 - lote ${meta.seq}`);
  doc.setAuthor("ADUNIR - Seção Sindical do ANDES-SN");
  doc.setSubject("Lista de apoiadores da petição pela sanção integral do PLV nº 12/2026");
  const font = await embed(doc, "NotoSans-Regular.ttf");
  const semi = await embed(doc, "NotoSans-SemiBold.ttf");
  const bold = await embed(doc, "NotoSans-ExtraBold.ttf");
  const logoA: PDFImage = await doc.embedPng(asset("adunir.png"));
  const logoN: PDFImage = await doc.embedPng(asset("andes.png"));
  const origin = (meta.origin ?? "https://sancionaintegral.org").replace(/\/$/, "");
  const host = origin.replace(/^https?:\/\//, "");
  const W = 595, H = 842, M = 46, CW = W - 2 * M, BOTTOM = 44;
  let page!: PDFPage;
  let y = 0;
  // QR Codes: operadores gráficos crus, um fluxo comprimido por página (milhares de drawRectangle deixariam a geração lenta).
  let qrOps = "";
  const flushQr = () => {
    if (!qrOps || !page) return;
    page.node.addContentStream(doc.context.register(doc.context.flateStream(`q 0.0196 0.2196 0.1647 rg\n${qrOps}f\nQ\n`)));
    qrOps = "";
  };

  const newPage = (first = false) => {
    flushQr();
    page = doc.addPage([W, H]);
    if (first) { y = H; return; }
    page.drawRectangle({ x: 0, y: H - 16, width: W, height: 16, color: GREEN });
    page.drawText(clean("Petição pela sanção integral do PLV nº 12/2026  ·  Iniciativa organizada pela ADUNIR – Seção Sindical do ANDES-SN", semi), { x: M, y: H - 11, size: 7, font: semi, color: WHITE });
    y = H - 16 - 28;
  };
  const ensure = (need: number) => { if (y - need < BOTTOM + 14) newPage(); };
  const para = (text: string, f = font, size = 10.5, gap = 6, color = INK) => {
    if (f === bold && size >= 11 && gap <= 8) ensure(size + 70); // título: não fica sozinho no fim da página
    for (const l of wrap(text, f, size, CW)) { ensure(size + 4); page.drawText(l, { x: M, y, size, font: f, color }); y -= size + 4; }
    y -= gap;
  };

  // ---- Capa: faixa verde com o título, os logos (ADUNIR + ANDES-SN) e a linha amarela
  newPage(true);
  const titleSize = 16;
  const titleLines = wrap(PETICAO.title, bold, titleSize, CW);
  const bandH = 30 + titleLines.length * 20 + 14 + 44 + 14;
  page.drawRectangle({ x: 0, y: H - bandH, width: W, height: bandH, color: GREEN });
  page.drawRectangle({ x: 0, y: H - bandH - 4, width: W, height: 4, color: YELLOW });
  page.drawText(clean("PETIÇÃO PÚBLICA  ·  INICIATIVA ORGANIZADA PELA ADUNIR – SEÇÃO SINDICAL DO ANDES-SN", semi), { x: M, y: H - 22, size: 7.5, font: semi, color: YELLOW });
  let ty = H - 48;
  for (const l of titleLines) { page.drawText(l, { x: M, y: ty, size: titleSize, font: bold, color: WHITE }); ty -= 20; }
  // faixa branca com os logos da ADUNIR e do ANDES-SN lado a lado
  const aH = 30, aW = (logoA.width / logoA.height) * aH, nH = 38, nW = (logoN.width / logoN.height) * nH;
  const stripW = 14 + aW + 16 + nW + 14;
  page.drawRectangle({ x: M, y: H - bandH + 14, width: stripW, height: 46, color: WHITE });
  page.drawImage(logoA, { x: M + 14, y: H - bandH + 14 + (46 - aH) / 2, width: aW, height: aH });
  page.drawRectangle({ x: M + 14 + aW + 8, y: H - bandH + 14 + 8, width: 0.8, height: 30, color: LINE });
  page.drawImage(logoN, { x: M + 14 + aW + 16, y: H - bandH + 14 + (46 - nH) / 2, width: nW, height: nH });
  y = H - bandH - 4 - 26;

  const brazil = rows.filter((r) => r.category !== "estrangeiro");
  const foreign = rows.filter((r) => r.category === "estrangeiro").sort((x, y) =>
    countryName(x.country ?? "", "pt").localeCompare(countryName(y.country ?? "", "pt"), "pt") || (x.university ?? "").localeCompare(y.university ?? "", "pt") || x.name.localeCompare(y.name, "pt"));

  const text = (d: Doc, o: { organizer?: boolean; title?: boolean } = {}) => {
    if (o.title !== false) para(d.title, bold, 14, 8, GREEN);
    if (o.organizer !== false) para(`Organização responsável: ${PETICAO.organizer}`, font, 9, 2, MUTED);
    para(`Destinatário: ${d.recipient}. Com cópia: ${d.copies}`, font, 9, 10, MUTED);
    para(d.salutation);
    for (const p of d.intro) para(p);
    para(d.reasonsTitle, bold, 11.5, 4, GREEN);
    d.reasons.forEach((r, i) => para(`${i + 1}. ${r}`));
    para(d.requestTitle, bold, 11.5, 4, GREEN);
    para(d.request);
    para(d.closing, font, 10.5, 2);
    para(d.signedBy, bold, 10.5, 12, GREEN);
  };

  /** Um bloco por assinatura: QR à esquerda; nome em destaque; instituição; cargo e lotação (servidor da Amazônia Legal/Faixa de Fronteira); frase de assinatura; código. */
  const BH = 98;
  const sigBlock = (r: ListRow, n: number, foreignList: boolean) => {
    ensure(BH + 6);
    const top = y, bottom = y - BH;
    const verified = r.cpf_name_check === "match";
    page.drawRectangle({ x: M, y: bottom, width: CW, height: BH, color: WHITE, borderColor: LINE, borderWidth: 0.8 });
    page.drawRectangle({ x: M, y: bottom, width: 3.5, height: BH, color: verified ? GREEN2 : LINE });
    const code = r.verify_code ?? "";
    const qr = qrMatrix(`${origin}/verificar/${code || "indisponivel"}`);
    const qs = 62, qx = M + 12, qy = bottom + (BH - qs) / 2, m = qs / qr.n;
    for (let rr = 0; rr < qr.n; rr++) {
      for (let c = 0; c < qr.n; c++) {
        if (!qr.on(rr, c)) continue;
        let w = 1; while (c + w < qr.n && qr.on(rr, c + w)) w++;
        qrOps += `${(qx + c * m).toFixed(2)} ${(qy + qs - (rr + 1) * m).toFixed(2)} ${(w * m).toFixed(2)} ${m.toFixed(2)} re\n`;
        c += w - 1;
      }
    }
    const x0 = M + 12 + qs + 14, w0 = CW - (x0 - M) - 10;
    const num = r.seq ?? n;
    page.drawText(`Nº ${num}`, { x: x0, y: top - 14, size: 8, font: semi, color: MUTED });
    if (code) { const t = `código ${formatCode(code)}`; page.drawText(t, { x: M + CW - 10 - wid(font, t, 8), y: top - 14, size: 8, font, color: MUTED }); }
    const ns = fit(r.name, bold, 13.5, w0);
    page.drawText(clean(r.name, bold), { x: x0, y: top - 31, size: ns, font: bold, color: GREEN });
    const who = foreignList
      ? [r.university, r.country ? `(${countryName(r.country, "pt")})` : ""].filter(Boolean).join(" ")
      : r.category === "servidor" ? institutionLabel(r.institution) : [r.city, r.uf].filter(Boolean).join("/");
    page.drawText(cutTo(who, font, 9.5, w0), { x: x0, y: top - 45, size: 9.5, font, color: INK });
    if (!foreignList && r.category === "servidor" && r.region_validated) {
      const mun = municipalityById(r.campus_ibge);
      const lot = mun ? `${mun.name}/${mun.uf}` : r.campus ?? "";
      const line = [ROLE(r.role) ? `Cargo: ${ROLE(r.role)}` : "", lot ? `Lotado(a) em: ${lot}` : ""].filter(Boolean).join("  ·  ");
      if (line) page.drawText(cutTo(line, semi, 8.5, w0), { x: x0, y: top - 57, size: 8.5, font: semi, color: INK });
    }
    const st = wrap(statementLine({ category: r.category, cpf_name_check: r.cpf_name_check ?? null, confirmed_at: r.confirmed_at ?? null }), font, 7.5, w0).slice(0, 2);
    st.forEach((l, i) => page.drawText(l, { x: x0, y: top - 69 - i * 9.5, size: 7.5, font, color: MUTED }));
    page.drawText(cutTo(`Autenticidade: ${host}/verificar${code ? ` · código ${formatCode(code)}` : ""}`, font, 7, w0), { x: x0, y: bottom + 6, size: 7, font, color: MUTED });
    y = bottom - 6;
  };

  // ---- Parte 1: texto, totais e lista do Brasil
  text(PETICAO, { title: false });
  ensure(120);
  para(meta.kind === "final" ? `Lista final de apoiadores do Brasil (acumulada): lote ${meta.seq}` : `Lista de apoiadores do Brasil: lote ${meta.seq}`, bold, 12.5, 4, GREEN);
  const totals =
    `Total neste documento: ${rows.length}${foreign.length ? ` (Brasil: ${brazil.length}; exterior: ${foreign.length})` : ""}. Brasil: servidores de IFES ${meta.nServidor}; apoiadores da sociedade civil ${meta.nApoiador}. ` +
    `Gerado em ${brasilia(meta.generatedAt, true) || meta.generatedAt}. Assinaturas confirmadas por e-mail; o aceite do texto, a data e a versão do texto ficam registrados com a organização. ` +
    `A condição de servidor é declarada pelo signatário. CPF, e-mail, data de nascimento e nome da mãe não constam desta lista. Cada assinatura tem um código e um QR Code que levam à página de verificação em ${host}/verificar.` +
    (meta.nInstitucional !== undefined
      ? ` Selos informativos: e-mail de domínio institucional (órgão ou instituição pública, ou de ensino superior; não comprova ser servidor): ${meta.nInstitucional}; ` +
        `e-mail de domínio de discentes: ${meta.nDiscente ?? 0}; nome conferido em base de CPF (a base pode estar defasada): ${meta.nNomeConferido ?? 0}.`
      : "");
  const tl = wrap(totals, font, 8.8, CW - 16);
  ensure(tl.length * 12 + 18);
  page.drawRectangle({ x: M, y: y - tl.length * 12 - 6, width: CW, height: tl.length * 12 + 14, color: SOFT });
  let by = y - 6;
  for (const l of tl) { page.drawText(l, { x: M + 8, y: by, size: 8.8, font, color: INK }); by -= 12; }
  y = y - tl.length * 12 - 22;
  const breathe = (i: number) => (i % 25 === 24 ? new Promise<void>((res) => setImmediate(res)) : undefined); // cede o processador: o site segue respondendo durante PDFs grandes
  for (let i = 0; i < brazil.length; i++) { sigBlock(brazil[i], i + 1, false); await breathe(i); }

  // ---- Parte 2: versão para estrangeiros (em português) e lista por país e universidade
  if (foreign.length) {
    newPage();
    const countries = [...new Set(foreign.map((r) => countryName(r.country ?? "", "pt")))];
    para("PARTE 2: PROFESSORES, TÉCNICOS E ACADÊMICOS DO EXTERIOR", bold, 11.5, 6, GREEN);
    text(estrangeiroPdfPt(countries), { organizer: false });
    para(`Lista do exterior (${foreign.length}), por país e universidade. E-mails validados como de universidade; CPF não se aplica.`, bold, 11, 6, GREEN);
    for (let i = 0; i < foreign.length; i++) { sigBlock(foreign[i], i + 1, true); await breathe(i); }
  }

  flushQr();
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    p.drawText(clean(`Lote ${meta.seq} | lista sha256 ${meta.listHash.slice(0, 16)} | texto ${TEXT_VERSION.slice(0, 12)} | ${meta.signedNote} | pág. ${i + 1}/${pages.length}`, font),
      { x: M, y: 24, size: 7, font, color: MUTED });
    if (meta.preview) {
      // Prévia: marca-d'água diagonal e faixa no rodapé, para nunca ser confundida com o documento enviado.
      p.drawText("PRÉVIA", { x: 130, y: 250, size: 120, font: bold, color: rgb(0.85, 0.2, 0.2), opacity: 0.12, rotate: degrees(40) });
      p.drawRectangle({ x: 0, y: 0, width: W, height: 14, color: YELLOW });
      p.drawText(clean(meta.preview, semi), { x: M, y: 4, size: 7, font: semi, color: INK });
    }
  });
  return doc.save();
}

/** Compatibilidade: antes exportava a limpeza para o alfabeto Latin-1; testes antigos podem importar `safe`. */
export const safe = (s: string) => s.replace(/\*\*/g, "");
