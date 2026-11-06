"use client";
import { useState, type ReactNode } from "react";

/** Abas simples (ex.: "IFES" e "Campi"). Só a aba escolhida é desenhada. Teclado: setas esquerda/direita. */
export default function Abas({ abas, inicial = 0 }: { abas: { id: string; rotulo: string; conteudo: ReactNode }[]; inicial?: number }) {
  const [i, setI] = useState(inicial);
  return (
    <div>
      <div className="v2-abas-conteudo" role="tablist" onKeyDown={(e) => { if (e.key === "ArrowRight") setI((x) => (x + 1) % abas.length); if (e.key === "ArrowLeft") setI((x) => (x + abas.length - 1) % abas.length); }}>
        {abas.map((a, k) => <button key={a.id} type="button" role="tab" id={`aba-${a.id}`} aria-selected={k === i} aria-controls={`pn-${a.id}`} tabIndex={k === i ? 0 : -1} className="v2-aba-btn" onClick={() => setI(k)}>{a.rotulo}</button>)}
      </div>
      <div role="tabpanel" id={`pn-${abas[i].id}`} aria-labelledby={`aba-${abas[i].id}`}>{abas[i].conteudo}</div>
    </div>
  );
}
