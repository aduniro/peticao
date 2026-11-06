// Gera public/data/geo/brasil-svg.json (mapa do Brasil por estado, em SVG) a partir de public/data/geo/estados.geojson (malha de UF do IBGE).
// Projeção equiretangular corrigida pela latitude média; simplificação Douglas–Peucker. Uso: node scripts/gerar-brasil-svg.mjs
import { readFileSync, writeFileSync } from "node:fs";
const geo = JSON.parse(readFileSync(new URL("../public/data/geo/estados.geojson", import.meta.url), "utf8"));
const REG = { N: ["AC", "AM", "AP", "PA", "RO", "RR", "TO"], NE: ["AL", "BA", "CE", "MA", "PB", "PE", "PI", "RN", "SE"], SE: ["ES", "MG", "RJ", "SP"], S: ["PR", "RS", "SC"], CO: ["DF", "GO", "MS", "MT"] };
const regDe = (uf) => Object.entries(REG).find(([, l]) => l.includes(uf))?.[0] ?? "?";
const K = Math.cos((-14 * Math.PI) / 180);
const polys = (g) => (g.type === "Polygon" ? [g.coordinates] : g.coordinates);
let minx = 1e9, maxx = -1e9, miny = 1e9, maxy = -1e9;
for (const f of geo.features) for (const p of polys(f.geometry)) for (const [lon, lat] of p[0]) { const x = lon * K, y = -lat; minx = Math.min(minx, x); maxx = Math.max(maxx, x); miny = Math.min(miny, y); maxy = Math.max(maxy, y); }
const W = 860, esc = W / (maxx - minx), H = Math.round((maxy - miny) * esc);
const proj = ([lon, lat]) => [(lon * K - minx) * esc, (-lat - miny) * esc];
function dp(pts, tol) { // Douglas–Peucker
  if (pts.length < 3) return pts;
  const d2 = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1]; const t = dx || dy ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))) : 0; const x = a[0] + t * dx - p[0], y = a[1] + t * dy - p[1]; return x * x + y * y; };
  let m = 0, i = 0; for (let k = 1; k < pts.length - 1; k++) { const v = d2(pts[k], pts[0], pts[pts.length - 1]); if (v > m) { m = v; i = k; } }
  if (m > tol * tol) { const a = dp(pts.slice(0, i + 1), tol), b = dp(pts.slice(i), tol); return a.slice(0, -1).concat(b); }
  return [pts[0], pts[pts.length - 1]];
}
const area = (r) => { let a = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; a += x1 * y2 - x2 * y1; } return a / 2; };
const cent = (r) => { let a = 0, cx = 0, cy = 0; for (let i = 0; i < r.length; i++) { const [x1, y1] = r[i], [x2, y2] = r[(i + 1) % r.length]; const c = x1 * y2 - x2 * y1; a += c; cx += (x1 + x2) * c; cy += (y1 + y2) * c; } a /= 2; return a ? [cx / (6 * a), cy / (6 * a)] : r[0]; };
const f1 = (n) => Math.round(n * 10) / 10;
const ufs = {};
for (const f of geo.features) {
  const uf = f.properties.sigla; let d = "", maior = null, ar = 0, bx0 = 1e9, bx1 = -1e9, by0 = 1e9, by1 = -1e9;
  for (const p of polys(f.geometry)) {
    const r = dp(p[0].map(proj), 0.45); if (r.length < 4 && Math.abs(area(r)) < 4) continue;
    d += "M" + r.map(([x, y]) => `${f1(x)} ${f1(y)}`).join("L") + "Z";
    for (const [x, y] of r) { bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y); }
    const a = Math.abs(area(r)); if (a > ar) { ar = a; maior = r; }
  }
  const [cx, cy] = cent(maior);
  ufs[uf] = { nome: f.properties.nome, reg: regDe(uf), d, cx: f1(cx), cy: f1(cy), bw: f1(bx1 - bx0), bh: f1(by1 - by0) };
}
const saida = { fonte: "IBGE — malha de unidades da federação (public/data/geo/estados.geojson); projeção equiretangular corrigida, simplificada", w: W, h: H, ufs, regioes: REG, pequenos: ["CE", "RN", "PB", "PE", "AL", "SE", "DF", "ES", "RJ"] };
writeFileSync(new URL("../public/data/geo/brasil-svg.json", import.meta.url), JSON.stringify(saida));
console.log("UFs:", Object.keys(ufs).length, "| viewBox:", W, "x", H, "| tamanho:", Math.round(JSON.stringify(saida).length / 1024), "KB");
