"use client";
import { useState } from "react";

type Item = { id: string; grupo: string; titulo: string; palavra: string | null; efeito: string };
type Saida = { efeito?: string; palavra?: string | null; resultado?: unknown; erro?: string; detalhe?: string; modo?: string };

const ERROS: Record<string, string> = { confirmacao: "A palavra de confirmação não confere.", ocupado: "Esta ação já está em andamento. Aguarde.", parametros: "Parâmetros inválidos.", falhou: "A ação falhou.", acao_desconhecida: "Ação desconhecida.", stepup: "A confirmação extra venceu. Confirme de novo." };

function Cartao({ a }: { a: Item }) {
  const [ini, setIni] = useState(""), [fim, setFim] = useState(""), [conf, setConf] = useState("");
  const [saida, setSaida] = useState<Saida | null>(null), [ocupado, setOcupado] = useState(false), [simulou, setSimulou] = useState(false);
  const parametros = () => (a.id === "reenvio.iniciar" ? { ini: ini ? new Date(ini).toISOString() : undefined, fim: fim ? new Date(fim).toISOString() : undefined } : {});
  const rodar = async (modo: "simular" | "executar") => {
    setOcupado(true);
    try {
      const r = await fetch("/api/admin/acoes", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ acao: a.id, modo, parametros: parametros(), confirmacao: conf }) });
      const j: Saida = await r.json().catch(() => ({ erro: "falhou" }));
      if (r.status === 403 && j.erro === "stepup") { window.location.assign("/admin/confirmar?volta=/admin/acoes"); return; }
      setSaida(j);
      if (modo === "simular" && !j.erro) setSimulou(true);
      if (modo === "executar" && !j.erro) { setSimulou(false); setConf(""); }
    } finally { setOcupado(false); }
  };
  return (
    <section className="box" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>{a.titulo}</h2>
      <p>{a.efeito}</p>
      {a.id === "reenvio.iniciar" ? (
        <div className="form" style={{ maxWidth: 420 }}>
          <label>Início da janela (vazio = 04/11 às 04h)<input type="datetime-local" value={ini} onChange={(e) => { setIni(e.target.value); setSimulou(false); }} /></label>
          <label>Fim da janela (vazio = 04/11 às 12h)<input type="datetime-local" value={fim} onChange={(e) => { setFim(e.target.value); setSimulou(false); }} /></label>
        </div>
      ) : null}
      <p>
        <button type="button" onClick={() => rodar("simular")} disabled={ocupado}>{a.palavra ? "Simular (não altera nada)" : "Ver"}</button>
        {a.palavra && simulou ? (<> {" "}<label style={{ display: "inline-block" }}>Digite <strong>{a.palavra}</strong> para confirmar <input value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="off" style={{ width: 130 }} /></label> <button type="button" onClick={() => rodar("executar")} disabled={ocupado || conf.trim() !== a.palavra}>Executar</button></>) : null}
      </p>
      {saida?.erro ? <p className="err" role="alert">{ERROS[saida.erro] ?? saida.erro}{saida.detalhe ? ` (${saida.detalhe})` : ""}</p> : null}
      {saida && !saida.erro ? <><p className="small">{saida.modo === "executar" ? "Executado:" : "Simulação:"}</p><pre className="small" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{JSON.stringify(saida.resultado, null, 2)}</pre></> : null}
    </section>
  );
}

export default function Acoes({ acoes }: { acoes: Item[] }) {
  return <>{acoes.map((a) => <Cartao key={a.id} a={a} />)}</>;
}
