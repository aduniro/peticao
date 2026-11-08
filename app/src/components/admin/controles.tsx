"use client";
import type { Faceta } from "@/lib/assinaturas-explorar";

/** Controles do painel feitos à mão (sem biblioteca): multisseleção, botões de escolha, caixa de seleção e slider de 1 ou 2 nós. */
export function Multi({ rotulo, opcoes, valor, onChange }: { rotulo: string; opcoes: Faceta[]; valor: string[]; onChange: (v: string[]) => void }) {
  const lista = [...opcoes]; for (const v of valor) if (!lista.some((o) => o.v === v)) lista.push({ v, n: 0 });
  return (
    <details className="adm-multi">
      <summary>{rotulo}{valor.length ? <b> · {valor.length}</b> : null}</summary>
      <div className="adm-multi-box">
        {lista.length === 0 ? <em>sem opções</em> : lista.map((o) => (
          <label key={o.v} className="adm-check"><input type="checkbox" checked={valor.includes(o.v)} onChange={(e) => onChange(e.target.checked ? [...valor, o.v] : valor.filter((x) => x !== o.v))} /> {o.rotulo ?? o.v}{o.n ? <small> ({o.n})</small> : null}</label>
        ))}
        {valor.length ? <button type="button" className="adm-btn" onClick={() => onChange([])}>Limpar</button> : null}
      </div>
    </details>
  );
}

export function Segmentado<T extends string>({ rotulo, opcoes, valor, onChange }: { rotulo: string; opcoes: { v: T; t: string }[]; valor: T; onChange: (v: T) => void }) {
  return (
    <div className="adm-seg" role="radiogroup" aria-label={rotulo}>
      {opcoes.map((o) => <button key={o.v} type="button" role="radio" aria-checked={valor === o.v} className={valor === o.v ? "on" : ""} onClick={() => onChange(o.v)}>{o.t}</button>)}
    </div>
  );
}

export function Caixa({ rotulo, marcado, onChange }: { rotulo: string; marcado: boolean; onChange: (v: boolean) => void }) {
  return <label className="adm-check"><input type="checkbox" checked={marcado} onChange={(e) => onChange(e.target.checked)} /> {rotulo}</label>;
}

/** Slider de um nó (`valor: number`) ou de dois nós (`valor: [a, b]`). */
export function Faixa({ rotulo, min, max, valor, onChange, formato = String }: { rotulo: string; min: number; max: number; valor: number | [number, number]; onChange: (v: any) => void; formato?: (n: number) => string }) {
  const dois = Array.isArray(valor);
  const [a, b] = dois ? valor : [min, valor as number];
  const pct = (n: number) => (max === min ? 0 : ((n - min) / (max - min)) * 100);
  return (
    <div className="adm-faixa">
      <div className="adm-faixa-top"><span>{rotulo}</span><b>{dois ? `${formato(a)} → ${formato(b)}` : formato(b)}</b></div>
      <div className="adm-faixa-trilho">
        <div className="adm-faixa-cheia" style={{ left: dois ? `${pct(a)}%` : 0, width: `${pct(b) - (dois ? pct(a) : 0)}%` }} />
        {dois ? <input type="range" min={min} max={max} value={a} aria-label={`${rotulo}: início`} onChange={(e) => onChange([Math.min(Number(e.target.value), b), b])} /> : null}
        <input type="range" min={min} max={max} value={b} aria-label={dois ? `${rotulo}: fim` : rotulo} onChange={(e) => onChange(dois ? [a, Math.max(Number(e.target.value), a)] : Number(e.target.value))} />
      </div>
    </div>
  );
}
