"use client";
import { useEffect, useRef, useState } from "react";
import { brasilia } from "@/lib/time";

type Receipt = { estado: string; candidato: string; id: string; fim: string; codigo: number | null };
type Row = { id: number; ts: string; email: string; acao: string; modo: string; central_estado: string; central_request_id: string | null; publicacao: Receipt | null };
const UNCERTAIN = "Não foi possível confirmar o resultado da ação. Verifique a situação do serviço antes de tentar novamente.";
const STATE: Record<string, string> = { solicitado: "Em andamento", indeterminado: "Resultado a conferir", falhou: "Não aplicada", concluido: "Concluída", aceito: "Pedido aceito", legacy: "Histórico anterior" };
const validRows = (value: unknown): value is Row[] => Array.isArray(value) && value.length <= 30 && value.every(row => row && Number.isSafeInteger(row.id) && row.id > 0 && typeof row.ts === "string" && Number.isFinite(Date.parse(row.ts)) && ["email", "acao", "modo", "central_estado"].every(key => typeof row[key] === "string"));
async function request(init: RequestInit = {}, query = "") {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15_000);
  try { const response = await fetch(`/api/admin/acoes${query}`, { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal }); return { response, data: await response.json() }; }
  finally { clearTimeout(timer); }
}

/** Reconciliation reads the exact executor receipt. It never calls an action again. */
export default function HistoricoAcoes() {
  const [rows, setRows] = useState<Row[]>([]), [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const singleFlight = useRef(false), mounted = useRef(true);
  const auth = (status: number, data: { erro?: string }) => {
    if (status === 401) { window.location.assign("/admin"); return true; }
    if (status === 403 && data.erro === "stepup") { window.location.assign("/admin/confirmar?volta=%2Fadmin%2Facoes"); return true; }
    if (status === 403) { window.location.assign("/admin?erro=nivel"); return true; }
    return false;
  };
  const load = async (before?: number) => {
    if (singleFlight.current) return; singleFlight.current = true; setBusy(true); setError(null);
    try {
      const { response, data } = await request({}, `?limite=30${before ? `&antes=${before}` : ""}`);
      if (!mounted.current || auth(response.status, data)) return;
      if (!response.ok || data?.ok !== true || !validRows(data.registros) || data.proximo !== null && (!Number.isSafeInteger(data.proximo) || data.proximo <= 0 || before !== undefined && data.proximo >= before) || before !== undefined && data.registros.some((row: Row) => row.id >= before)) throw new Error("invalid_page");
      setRows(previous => { const merged = new Map((before ? previous : []).map(row => [row.id, row])); for (const row of data.registros) merged.set(row.id, row); return [...merged.values()]; }); setNext(data.proximo);
    } catch { if (mounted.current) setError("Não foi possível carregar a lista. Tente novamente."); }
    finally { singleFlight.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; }; }, []);
  const reconcile = async (id: number) => {
    if (singleFlight.current) return; singleFlight.current = true; setBusy(true); setError(null);
    try {
      const { response, data } = await request({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ modo: "conciliar", id }) });
      if (!mounted.current || auth(response.status, data)) return;
      if (!response.ok || data?.ok !== true || data.id !== id || typeof data.estado !== "string" || !data.publicacao) throw new Error("unconfirmed");
      setRows(previous => previous.map(row => row.id === id ? { ...row, central_estado: data.estado, publicacao: data.publicacao } : row));
    } catch { if (mounted.current) setError(UNCERTAIN); }
    finally { singleFlight.current = false; if (mounted.current) setBusy(false); }
  };
  return <section className="box" data-testid="action-history" aria-busy={busy}>
    <h2>Histórico de ações</h2><p className="small">A conferência consulta o resultado do executor; não executa a ação novamente.</p>
    <div className="table-scroll"><table><thead><tr><th>ID</th><th>Data</th><th>Usuário</th><th>Ação</th><th>Modo</th><th>Situação</th><th>Ações</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.id} data-action-id={row.id}><td>{row.id}</td><td>{brasilia(row.ts)}</td><td>{row.email}</td><td>{row.acao}</td><td>{row.modo}</td><td>{row.publicacao?.estado === "ok" ? "Publicação concluída" : STATE[row.central_estado] ?? row.central_estado}</td><td>{row.acao === "publicar.pedir" && row.modo === "executar" && row.central_request_id && row.central_estado !== "legacy" && row.publicacao?.estado !== "ok" ? <button type="button" className="adm-btn sm" disabled={busy} onClick={() => reconcile(row.id)}>Conferir resultado</button> : null}</td></tr>)}</tbody>
    </table></div>
    {error ? <p className="err" role="alert">{error}</p> : null}
    <p><button type="button" className="adm-btn sm" disabled={busy} onClick={() => load()}>Atualizar</button>{next !== null ? <> <button type="button" className="adm-btn sm" disabled={busy} onClick={() => load(next)}>Carregar mais</button></> : null}</p>
  </section>;
}
