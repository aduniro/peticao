"use client";
import { useMemo, useState } from "react";

export type ItemBarra = { nome: string; valor: number; extra?: string; href?: string };
/** Ranking interativo (substitui as listas de texto): barras proporcionais, busca, "ver todos" e clique que filtra/navega. */
export default function BarraLista({ itens, titulo, limite = 8, vazio = "Sem dados.", unidade = "", onEscolher }: { itens: ItemBarra[]; titulo?: string; limite?: number; vazio?: string; unidade?: string; onEscolher?: (i: ItemBarra) => void }) {
  const [todos, setTodos] = useState(false);
  const [q, setQ] = useState("");
  const lista = useMemo(() => { const n = q.trim().toLowerCase(); return [...itens].sort((a, b) => b.valor - a.valor).filter((i) => !n || i.nome.toLowerCase().includes(n)); }, [itens, q]);
  const max = Math.max(1, ...itens.map((i) => i.valor)), soma = itens.reduce((a, i) => a + i.valor, 0) || 1;
  const vis = todos ? lista : lista.slice(0, limite);
  return (
    <div className="v2-barras">
      {titulo ? <h3 className="v2-barras-t">{titulo}</h3> : null}
      {itens.length > 12 ? <input className="v2-barras-busca" type="search" placeholder="Buscar…" aria-label={`Buscar em ${titulo ?? "lista"}`} value={q} onChange={(e) => setQ(e.target.value)} /> : null}
      {itens.length === 0 ? <p className="v2-vazio">{vazio}</p> : (
        <ul>
          {vis.map((i) => {
            const conteudo = (<><span className="v2-barras-nome" title={i.nome}>{i.nome}</span><span className="v2-barras-trilho"><i style={{ width: `${Math.max(2, (i.valor / max) * 100)}%` }} /></span><b>{i.valor}{unidade}</b><small>{Math.round((i.valor / soma) * 100)}%</small></>);
            return <li key={i.nome}>{i.href ? <a href={i.href}>{conteudo}</a> : onEscolher ? <button type="button" onClick={() => onEscolher(i)}>{conteudo}</button> : <div>{conteudo}</div>}</li>;
          })}
        </ul>
      )}
      {lista.length > limite ? <button type="button" className="v2-btn v2-btn-sec v2-pequeno" onClick={() => setTodos(!todos)}>{todos ? "Ver menos" : `Ver todos (${lista.length})`}</button> : null}
    </div>
  );
}
