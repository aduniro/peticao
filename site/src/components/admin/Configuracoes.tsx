"use client";
import { useState } from "react";

type Config = { popupEstado: boolean; popupRegiao: boolean };
const ITENS: { chave: keyof Config; titulo: string; texto: string }[] = [
  { chave: "popupEstado", titulo: "Popup ao clicar num estado", texto: "Na visão geral, clicar num estado (no mapa ou na faixa de estados) abre um quadro com total, confirmadas, aguardando, categorias, IFES e campus líderes e os rankings. Desligado, clicar no estado leva direto ao mapa interativo." },
  { chave: "popupRegiao", titulo: "Popup ao clicar numa região", texto: "Na visão geral, clicar no nome ou na barra de uma região (Norte, Nordeste...) abre o mesmo quadro. Desligado, clicar na região apenas expande a linha; a seta à direita continua expandindo nos dois casos." },
];

/** Interruptores das preferências do painel. Cada clique grava na hora (só o nível Total consegue). */
export default function Configuracoes({ inicial, podeEditar }: { inicial: Config; podeEditar: boolean }) {
  const [cfg, setCfg] = useState<Config>(inicial);
  const [msg, setMsg] = useState<{ tipo: "ok" | "erro"; t: string } | null>(null), [ocupado, setOcupado] = useState<string | null>(null);
  const mudar = async (chave: keyof Config, valor: boolean) => {
    setOcupado(chave); setMsg(null);
    try {
      const r = await fetch("/api/admin/configuracoes", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ chave, valor }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) { setMsg({ tipo: "erro", t: r.status === 403 ? "O seu nível de acesso não permite alterar." : "Não foi possível salvar." }); return; }
      setCfg(j.config); setMsg({ tipo: "ok", t: "Salvo. Vale na hora para todos os usuários do painel." });
    } catch { setMsg({ tipo: "erro", t: "Falha de rede." }); } finally { setOcupado(null); }
  };
  return (
    <div>
      {ITENS.map((i) => (
        <div className="v2-cfg" key={i.chave}>
          <div><h3>{i.titulo}</h3><p className="v2-sub">{i.texto}</p></div>
          <label className="v2-chave">
            <input type="checkbox" role="switch" aria-label={i.titulo} checked={cfg[i.chave]} disabled={!podeEditar || ocupado === i.chave} onChange={(e) => mudar(i.chave, e.target.checked)} />
            <span aria-hidden="true" />
            <b>{cfg[i.chave] ? "Ligado" : "Desligado"}</b>
          </label>
        </div>
      ))}
      {!podeEditar ? <p className="v2-aviso aten" role="status">Só o nível Total altera estas preferências.</p> : null}
      {msg ? <p className={`v2-aviso${msg.tipo === "erro" ? " erro" : ""}`} role={msg.tipo === "erro" ? "alert" : "status"}>{msg.t}</p> : null}
    </div>
  );
}
