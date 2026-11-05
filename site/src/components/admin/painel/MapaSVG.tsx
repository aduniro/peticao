"use client";
import { RAMPA, classe, textoSobre } from "@/lib/quantis";

export type Geo = { w: number; h: number; ufs: Record<string, { nome: string; reg: string; d: string; cx: number; cy: number; bw: number; bh: number }>; pequenos: string[] };
export type UfDado = { uf: string; nome: string; regiao: string; conf: number; pend: number; total: number };
const VAZIO = "#33493f";

/** Mapa do Brasil por estado (SVG próprio, sem Leaflet): degradê vermelho → azul por quantis, rótulos dentro dos estados e chamadas laterais para os pequenos. */
export default function MapaSVG({ geo, dados, cortes, destaque, selecionada, onDestaque, onEscolher }: { geo: Geo; dados: UfDado[]; cortes: number[]; destaque: string | null; selecionada: string | null; onDestaque: (uf: string | null) => void; onEscolher: (uf: string, x: number, y: number) => void }) {
  const por = new Map(dados.map((d) => [d.uf, d]));
  const cor = (uf: string) => { const n = por.get(uf)?.total ?? 0; const c = classe(n, cortes); return c < 0 ? VAZIO : RAMPA[c]; };
  const pequenos = geo.pequenos.filter((u) => geo.ufs[u]).sort((a, b) => geo.ufs[a].cy - geo.ufs[b].cy);
  const MARGEM = 150, passo = Math.min(34, (geo.h * 0.55) / Math.max(1, pequenos.length)), y0 = geo.h * 0.18;
  const pos = new Map(pequenos.map((u, i) => [u, { x: geo.w + 10, y: y0 + i * passo }]));
  const evento = (uf: string) => ({
    onMouseEnter: () => onDestaque(uf), onMouseLeave: () => onDestaque(null),
    onClick: (e: React.MouseEvent) => onEscolher(uf, e.clientX, e.clientY),
    onKeyDown: (e: React.KeyboardEvent) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); const r = (e.currentTarget as SVGGElement).getBoundingClientRect(); onEscolher(uf, r.x + r.width / 2, r.y + r.height / 2); } },
  });
  return (
    <svg className="v2-mapa-svg" viewBox={`0 0 ${geo.w + MARGEM} ${geo.h}`} preserveAspectRatio="xMidYMid meet" role="group" aria-label="Mapa do Brasil: assinaturas por estado">
      <defs><filter id="v2sombra" x="-5%" y="-5%" width="110%" height="110%"><feDropShadow dx="0" dy="2" stdDeviation="3" floodColor="#000" floodOpacity=".45" /></filter></defs>
      <g filter="url(#v2sombra)">
        {Object.entries(geo.ufs).map(([uf, g]) => (
          <g key={uf} tabIndex={0} role="button" aria-label={`${g.nome}: ${por.get(uf)?.total ?? 0} assinaturas`} className={`v2-uf${destaque === uf ? " hl" : ""}${selecionada === uf ? " sel" : ""}`} {...evento(uf)}>
            <path d={g.d} fill={cor(uf)} stroke="#ffffff" strokeWidth={1.2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </g>
        ))}
      </g>
      <g pointerEvents="none" fontFamily="system-ui, sans-serif" textAnchor="middle">
        {Object.entries(geo.ufs).filter(([uf, g]) => !pos.has(uf) && g.bw > 38).map(([uf, g]) => {
          const t = por.get(uf)?.total ?? 0, cl = textoSobre(cor(uf)); const fs = Math.max(10, Math.min(20, g.bw / 4.2));
          return (<g key={uf}><text x={g.cx} y={g.cy - (t ? 1 : -4)} fontSize={fs} fontWeight={800} fill={cl}>{uf}</text>{t > 0 && g.bw > 60 ? <text x={g.cx} y={g.cy + fs * 0.95} fontSize={fs * 0.85} fontWeight={600} fill={cl} opacity={0.92}>{t}</text> : null}</g>);
        })}
      </g>
      {pequenos.map((uf) => {
        const g = geo.ufs[uf], p = pos.get(uf)!, t = por.get(uf)?.total ?? 0;
        return (
          <g key={`c-${uf}`} className={`v2-uf${destaque === uf ? " hl" : ""}`} tabIndex={0} role="button" aria-label={`${g.nome}: ${t} assinaturas`} {...evento(uf)}>
            <line x1={g.cx} y1={g.cy} x2={p.x - 4} y2={p.y - 5} stroke="#ffffff" strokeOpacity={0.45} strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            <circle cx={g.cx} cy={g.cy} r={2.6} fill="#fff" />
            <rect x={p.x} y={p.y - 17} width={MARGEM - 20} height={26} rx={7} fill={cor(uf)} stroke="#fff" strokeOpacity={0.7} vectorEffect="non-scaling-stroke" />
            <text x={p.x + 10} y={p.y} fontSize={14} fontWeight={800} fill={textoSobre(cor(uf))} fontFamily="system-ui, sans-serif">{uf}</text>
            <text x={p.x + MARGEM - 30} y={p.y} fontSize={13} fontWeight={600} fill={textoSobre(cor(uf))} textAnchor="end" fontFamily="system-ui, sans-serif">{t}</text>
          </g>
        );
      })}
    </svg>
  );
}
