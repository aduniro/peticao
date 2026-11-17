"use client";

export type Periodo = { de: string; ate: string };
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
/** Atalhos: contam do dia de hoje para trás, em datas (inclusivas). "Tudo" = sem limite. */
export const atalho = (dias: number | null, hoje = new Date()): Periodo => {
  if (dias === null) return { de: "", ate: "" };
  const ini = new Date(hoje); ini.setDate(ini.getDate() - (dias - 1));
  return { de: iso(ini), ate: iso(hoje) };
};
const ATALHOS: { t: string; dias: number | null }[] = [{ t: "24 h", dias: 1 }, { t: "7 dias", dias: 7 }, { t: "30 dias", dias: 30 }, { t: "Tudo", dias: null }];

/** Calendário de período: data inicial e final (campos de data nativos) mais atalhos. `de`/`ate` no formato AAAA-MM-DD, vazio = sem limite. */
export default function SeletorPeriodo({ valor, onChange, rotulo = "Período" }: { valor: Periodo; onChange: (p: Periodo) => void; rotulo?: string }) {
  const ativo = ATALHOS.find((a) => { const p = atalho(a.dias); return p.de === valor.de && p.ate === valor.ate; })?.t;
  return (
    <fieldset className="v2-periodo" aria-label={rotulo} style={{ border: 0, padding: 0, margin: 0 }}>
      <div className="adm-seg" role="group" aria-label={`${rotulo}: atalhos`}>
        {ATALHOS.map((a) => <button key={a.t} type="button" className={ativo === a.t ? "on" : ""} aria-pressed={ativo === a.t} onClick={() => onChange(atalho(a.dias))}>{a.t}</button>)}
      </div>
      <label>De<input type="date" value={valor.de} max={valor.ate || undefined} onChange={(e) => onChange({ de: e.target.value, ate: valor.ate && e.target.value > valor.ate ? e.target.value : valor.ate })} /></label>
      <label>Até<input type="date" value={valor.ate} min={valor.de || undefined} onChange={(e) => onChange({ de: valor.de && e.target.value < valor.de ? e.target.value : valor.de, ate: e.target.value })} /></label>
      {valor.de || valor.ate ? <button type="button" className="adm-btn" onClick={() => onChange({ de: "", ate: "" })}>Limpar período</button> : null}
    </fieldset>
  );
}
