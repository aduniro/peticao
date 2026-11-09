"use client";
import { useId, useState, type ReactNode } from "react";

/** Abas simples (ex.: "IFES" e "Campi"). Só a aba escolhida é desenhada. Teclado: setas esquerda/direita. */
export default function Abas({ abas, inicial = 0, variante = "principal" }: { abas: { id: string; rotulo: string; conteudo: ReactNode }[]; inicial?: number; variante?: "principal" | "interna" }) {
  const [i, setI] = useState(inicial);
  const uid = useId().replace(/:/g, ""); // ids únicos mesmo com várias abas na mesma tela (popup + região expandida)
  return (
    <div>
      <div className={`v2-abas-conteudo ${variante}`} role="tablist" onKeyDown={(e) => { if (e.key === "ArrowRight") setI((x) => (x + 1) % abas.length); if (e.key === "ArrowLeft") setI((x) => (x + abas.length - 1) % abas.length); }}>
        {abas.map((a, k) => <button key={a.id} type="button" role="tab" id={`aba-${uid}-${a.id}`} aria-selected={k === i} aria-controls={`pn-${uid}-${a.id}`} tabIndex={k === i ? 0 : -1} className="v2-aba-btn" onClick={() => setI(k)}>{a.rotulo}</button>)}
      </div>
      <div key={abas[i].id} role="tabpanel" id={`pn-${uid}-${abas[i].id}`} aria-labelledby={`aba-${uid}-${abas[i].id}`}>{abas[i].conteudo}</div>
    </div>
  );
}
