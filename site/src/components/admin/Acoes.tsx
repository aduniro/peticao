"use client";
import { useEffect, useRef, useState } from "react";
import HistoricoAcoes from "./HistoricoAcoes";

type Item = { id: string; grupo: string; titulo: string; palavra: string | null; efeito: string };
type Intent = { id: number; token: string; expira: string };
type Pending = { intent: Intent; params: Record<string, unknown>; ini: string; fim: string; candidato: string };
type Saida = { ok?: boolean; simulacao?: Intent; encerrada?: boolean; efeito?: string; palavra?: string | null; resultado?: unknown; erro?: string; detalhe?: string; modo?: string };

const ERROS: Record<string, string> = { confirmacao: "A palavra de confirmação não confere.", ocupado: "Esta ação já está em andamento. Aguarde.", parametros: "Parâmetros inválidos.", falhou: "A ação falhou.", indeterminado: "Não foi possível confirmar o resultado da ação. Verifique a situação do serviço antes de tentar novamente.", acao_desconhecida: "Ação desconhecida.", stepup: "A confirmação extra venceu. Confirme de novo." };

function Cartao({ a, storageScope }: { a: Item; storageScope: string }) {
  const [candidato, setCandidato] = useState("");
  const [ini, setIni] = useState(""), [fim, setFim] = useState(""), [conf, setConf] = useState("");
  const [saida, setSaida] = useState<Saida | null>(null), [ocupado, setOcupado] = useState(false), [simulou, setSimulou] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null), [pending, setPending] = useState<Pending | null>(null);
  const revision = useRef(0), requestVersion = useRef(0), singleFlight = useRef(false);
  const key = `admin-action-v1:${storageScope}:${a.id}`;
  const remember = (value: Pending | null) => { setPending(value); try { if (value) sessionStorage.setItem(key, JSON.stringify(value)); else sessionStorage.removeItem(key); } catch { /* In-memory intent still protects retries in this tab. */ } };
  useEffect(() => {
    try {
      const value = JSON.parse(sessionStorage.getItem(key) ?? "null") as Pending | null;
      if (value && Number.isSafeInteger(value.intent?.id) && /^[a-f0-9]{48}$/.test(value.intent?.token) && value.params && typeof value.ini === "string" && typeof value.fim === "string" && typeof value.candidato === "string") {
        setIntent(value.intent); setPending(value); setIni(value.ini); setFim(value.fim); setCandidato(value.candidato); setSimulou(true);
        void rodar("consultar", value);
      }
    } catch { /* An invalid local snapshot never authorizes execution. */ }
    // Scope identifies the authenticated session; never auto-execute a recovered intent.
  }, [key]);
  const parametros = () => (a.id === "reenvio.iniciar" ? { ini: ini ? new Date(ini).toISOString() : undefined, fim: fim ? new Date(fim).toISOString() : undefined } : a.id === "publicar.pedir" ? { candidato: candidato || undefined } : {});
  const rodar = async (modo: "simular" | "executar" | "consultar", recovered?: Pending) => {
    if (singleFlight.current || modo === "executar" && pending) return;
    if (modo === "simular" && pending) return;
    const active = recovered ?? pending;
    const ticket = active?.intent ?? intent;
    const params = active?.params ?? parametros();
    const version = revision.current, requestId = ++requestVersion.current;
    if (modo === "executar") {
      if (!ticket) return;
      remember(active ?? { intent: ticket, params, ini, fim, candidato });
    }
    singleFlight.current = true; setOcupado(true);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
    try {
      const r = await fetch("/api/admin/acoes", { method: "POST", headers: { "content-type": "application/json" }, credentials: "same-origin", cache: "no-store", signal: controller.signal, body: JSON.stringify({ acao: a.id, modo, parametros: params, confirmacao: conf, simulacao: ticket }) });
      const j: Saida = await r.json().catch(() => ({ erro: modo === "executar" ? "indeterminado" : "falhou" }));
      if (requestId !== requestVersion.current) return;
      if (modo === "simular" && revision.current !== version) return;
      if (r.status === 401) { window.location.assign("/admin"); return; }
      if (r.status === 403 && j.erro === "stepup") { window.location.assign("/admin/confirmar?volta=/admin/acoes"); return; }
      if (r.status === 403) { window.location.assign("/admin?erro=nivel"); return; }
      setSaida(j);
      if (modo === "simular" && !j.erro) {
        const value = (j.resultado as { candidato?: { sha256?: unknown } } | undefined)?.candidato?.sha256;
        const valid = typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
        if (a.id === "publicar.pedir") setCandidato(valid ? value : "");
        const current = revision.current === version;
        setIntent(current ? j.simulacao ?? null : null);
        setSimulou(current && !!j.simulacao && (a.id !== "publicar.pedir" || valid));
      }
      if (j.modo === "executar" && !j.erro) { remember(null); setIntent(null); setSimulou(false); setConf(""); }
      if (j.encerrada) { remember(null); setIntent(null); setSimulou(false); }
    } catch { if (requestId === requestVersion.current) setSaida({ erro: modo === "simular" ? "falhou" : "indeterminado" }); } finally { clearTimeout(timer); singleFlight.current = false; if (requestId === requestVersion.current) setOcupado(false); }
  };
  return (
    <section className="box" style={{ marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>{a.titulo}</h2>
      <p>{saida?.efeito ?? a.efeito}</p>
      {a.id === "reenvio.iniciar" ? (
        <div className="form" style={{ maxWidth: 420 }}>
          <label>Início da janela (vazio = padrão exibido na simulação)<input type="datetime-local" disabled={!!pending} value={ini} onChange={(e) => { revision.current++; setIni(e.target.value); setSimulou(false); setIntent(null); setSaida(null); }} /></label>
          <label>Fim da janela (vazio = padrão exibido na simulação)<input type="datetime-local" disabled={!!pending} value={fim} onChange={(e) => { revision.current++; setFim(e.target.value); setSimulou(false); setIntent(null); setSaida(null); }} /></label>
        </div>
      ) : null}
      <p>
        <button type="button" onClick={() => rodar("simular")} disabled={ocupado || !!pending}>{a.palavra ? "Simular (não altera nada)" : "Ver"}</button>
        {a.palavra && simulou ? (<> {" "}<label style={{ display: "inline-block" }}>Digite <strong>{a.palavra}</strong> para confirmar <input value={conf} onChange={(e) => setConf(e.target.value)} autoComplete="off" style={{ width: 130 }} /></label> <button type="button" onClick={() => rodar("executar")} disabled={ocupado || !!pending || conf.trim() !== a.palavra}>Executar</button></>) : null}
        {pending ? <> <button type="button" onClick={() => rodar("consultar")} disabled={ocupado}>Conferir resultado</button></> : null}
      </p>
      {saida?.erro ? <p className="err" role="alert">{ERROS[saida.erro] ?? saida.erro}{saida.detalhe ? ` (${saida.detalhe})` : ""}</p> : null}
      {saida && !saida.erro ? <><p className="small">{saida.modo === "executar" ? a.id === "publicar.pedir" ? "Pedido registrado:" : "Executado:" : "Simulação:"}</p><pre className="small" style={{ whiteSpace: "pre-wrap", overflowX: "auto" }}>{JSON.stringify(saida.resultado, null, 2)}</pre></> : null}
    </section>
  );
}

export default function Acoes({ acoes, storageScope }: { acoes: Item[]; storageScope: string }) {
  return <>{acoes.map((a) => <Cartao key={a.id} a={a} storageScope={storageScope} />)}<HistoricoAcoes /></>;
}
