import { readFileSync } from "node:fs";
import { join } from "node:path";
import QRCode from "qrcode";
import { GOV_POINTS } from "@/content/governo";
import { Resvg } from "@resvg/resvg-js";

/** Cartaz de compartilhamento (4:5, bom para WhatsApp/Instagram) e imagem de pré-visualização do link (1200x630). */
const FONTS = () => ["Inter-Regular.otf", "Inter-SemiBold.otf", "Inter-ExtraBold.otf"].map((f) => join(process.cwd(), "assets", "fonts", f));
const logoCache = new Map<string, string>();
/** Logotipo como data URI (para embutir no SVG). */
export function logoDataUri(name: "adunir" | "andes"): string {
  let v = logoCache.get(name);
  if (!v) { v = `data:image/png;base64,${readFileSync(join(process.cwd(), "assets", `${name}.png`)).toString("base64")}`; logoCache.set(name, v); }
  return v;
}
/** Proporções (largura/altura) dos arquivos: ADUNIR 383×102, ANDES 442×300. */
export const LOGO_RATIO = { adunir: 383 / 102, andes: 442 / 300 } as const;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

/** Matriz do QR (para desenhar no PDF com retângulos vetoriais). */
export function qrMatrix(text: string): { n: number; on: (r: number, c: number) => boolean } {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  return { n: q.modules.size, on: (r, c) => !!q.modules.get(r, c) };
}

/** QR como um único <path> (linhas contínuas de módulos), na posição e tamanho indicados. */
export function qrPath(text: string, x: number, y: number, size: number): string {
  const q = QRCode.create(text, { errorCorrectionLevel: "M" });
  const n = q.modules.size, m = size / n;
  let d = "";
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      if (!q.modules.get(r, c)) continue;
      let w = 1;
      while (c + w < n && q.modules.get(r, c + w)) w++;
      d += `M${(x + c * m).toFixed(2)} ${(y + r * m).toFixed(2)}h${(w * m).toFixed(2)}v${m.toFixed(2)}h${(-w * m).toFixed(2)}z`;
      c += w - 1;
    }
  }
  return `<path d="${d}" fill="#0a2f20"/>`;
}

const T = (x: number, y: number, size: number, weight: number, fill: string, text: string, extra = "") =>
  `<text x="${x}" y="${y}" font-family="Inter" font-size="${size}" font-weight="${weight}" fill="${fill}" ${extra}>${esc(text)}</text>`;

/** Cartaz padrão e cartaz pessoal: o mesmo desenho (modelo verde dos 5 pontos + logos); o pessoal só troca o QR de indicação (nunca leva o nome de quem convidou). */
export function cardSvg(o: { link: string; displayLink: string; firstName?: string | null }): string {
  return govCardSvg(o);
}

export function ogSvg(displayLink: string): string {
  const ah = 56, aw = Math.round(ah * LOGO_RATIO.adunir), nh = 66, nw = Math.round(nh * LOGO_RATIO.andes);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05382a"/><stop offset="1" stop-color="#0d8452"/></linearGradient></defs>
<rect width="1200" height="630" fill="url(#g)"/><circle cx="1090" cy="60" r="240" fill="#ffffff" opacity=".07"/>
<rect x="70" y="60" width="300" height="52" rx="26" fill="#f5c518"/>${T(220, 96, 25, 800, "#4a3b00", "PETIÇÃO PÚBLICA", 'text-anchor="middle" letter-spacing="2"')}
${T(70, 230, 100, 800, "#ffffff", "Sancione o")}${T(70, 335, 100, 800, "#f5c518", "PLV 12/2026")}
${T(70, 405, 36, 600, "#ffffff", "Servidores das IFES em todos os campi situados na", 'opacity=".92"')}${T(70, 452, 36, 600, "#ffffff", "Amazônia Legal e na Faixa de Fronteira", 'opacity=".92"')}
<rect x="0" y="508" width="1200" height="122" fill="#ffffff"/>
<image href="${logoDataUri("adunir")}" x="70" y="${508 + Math.round((122 - ah) / 2)}" width="${aw}" height="${ah}"/>
<image href="${logoDataUri("andes")}" x="${70 + aw + 28}" y="${508 + Math.round((122 - nh) / 2)}" width="${nw}" height="${nh}"/>
${T(1130, 560, 24, 600, "#4a5b53", "Iniciativa da ADUNIR – Seção Sindical do ANDES-SN", 'text-anchor="end"')}
${T(1130, 598, 32, 800, "#05382a", displayLink, 'text-anchor="end"')}
</svg>`;
}

export function iconSvg(): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#0b6b45"/>
<rect x="126" y="86" width="260" height="340" rx="26" fill="#ffffff"/><rect x="164" y="140" width="184" height="18" rx="9" fill="#0b6b45" opacity=".35"/><rect x="164" y="186" width="150" height="18" rx="9" fill="#0b6b45" opacity=".35"/>
<path d="M170 330 l52 52 l120 -128" fill="none" stroke="#0b6b45" stroke-width="34" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
}

export function renderPng(svg: string, width: number): Buffer {
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles: FONTS(), loadSystemFonts: false, defaultFontFamily: "Inter" } });
  return Buffer.from(r.render().asPng());
}


/**
 * Cartaz de divulgação (1080 de largura, altura ajustada ao conteúdo): título, 5 pedidos (bem espaçados), QR Code e, por último, os logos da ADUNIR e do ANDES-SN com a iniciativa.
 * O cartaz pessoal usa o mesmo desenho, só com o QR de indicação; nunca leva o nome de quem convidou.
 */
export function govCardSvg(o: { link: string; displayLink: string; firstName?: string | null }): string {
  let cursor = 478;
  const rows = GOV_POINTS.map((p, i) => {
    const words = p.split(" "); const lines: string[] = []; let cur = "";
    for (const w of words) { if ((cur + " " + w).trim().length > 31 && cur) { lines.push(cur); cur = w; } else cur = (cur + " " + w).trim(); }
    lines.push(cur);
    const LH = 48, h = lines.length * LH, y = cursor + h / 2;
    cursor += h + 46;
    return `<circle cx="108" cy="${y}" r="32" fill="#f5c518"/>${T(108, y + 12, 36, 800, "#4a3b00", String(i + 1), 'text-anchor="middle"')}` +
      lines.map((l, k) => T(170, y + (k - (lines.length - 1) / 2) * LH + 13, 40, 600, "#ffffff", l)).join("");
  }).join("\n");
  const qrY = cursor + 6, qrH = 250, stripY = qrY + qrH + 30, stripH = 190, CARD_H = stripY + stripH + 64; // a altura acompanha o conteúdo: nada fica espremido nem cortado
  const ah = 66, aw = Math.round(ah * LOGO_RATIO.adunir), nh = 84, nw = Math.round(nh * LOGO_RATIO.andes);
  const gap = 44, rowW = aw + gap + nw, rx = Math.round((1080 - rowW) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${CARD_H}" viewBox="0 0 1080 ${CARD_H}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05382a"/><stop offset="1" stop-color="#0d8452"/></linearGradient></defs>
<rect width="1080" height="${CARD_H}" fill="url(#g)"/><circle cx="1000" cy="90" r="250" fill="#ffffff" opacity=".07"/>
<rect x="72" y="70" width="520" height="52" rx="26" fill="#f5c518"/>${T(332, 106, 26, 800, "#4a3b00", "PEDIDO AO GOVERNO FEDERAL", 'text-anchor="middle" letter-spacing="1.5"')}
${T(72, 230, 92, 800, "#ffffff", "Sancione o")}${T(72, 330, 92, 800, "#f5c518", "PLV 12/2026")}
${T(72, 392, 36, 600, "#ffffff", "Educação federal na Amazônia Legal e na fronteira", 'opacity=".92"')}
${rows}
<rect x="72" y="${qrY}" width="936" height="${qrH}" rx="32" fill="#ffffff"/>
${qrPath(o.link, 106, qrY + 30, 190)}
${T(336, qrY + 108, 44, 800, "#05382a", "Assine a petição pública")}
${T(336, qrY + 164, Math.max(22, Math.min(36, Math.floor(640 / (o.displayLink.length * 0.6)))), 700, "#0b6b45", o.displayLink)}
${T(336, qrY + 212, 28, 500, "#4a5b53", "Leva cerca de 1 minuto")}
<rect x="72" y="${stripY}" width="936" height="${stripH}" rx="32" fill="#ffffff"/>
${T(540, stripY + 54, 27, 700, "#05382a", "Iniciativa da ADUNIR – Seção Sindical do ANDES-SN", 'text-anchor="middle"')}
<image href="${logoDataUri("adunir")}" x="${rx}" y="${stripY + 80 + Math.round((nh - ah) / 2)}" width="${aw}" height="${ah}"/>
<rect x="${rx + aw + Math.round(gap / 2) - 1}" y="${stripY + 84}" width="2" height="${nh}" fill="#d5e0da"/>
<image href="${logoDataUri("andes")}" x="${rx + aw + gap}" y="${stripY + 80}" width="${nw}" height="${nh}"/>
</svg>`;
}
