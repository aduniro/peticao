"use client";
import { useMemo, useRef, useState } from "react";
import { adminJsonRequest as chamar } from "@/lib/admin-request";

export type Linha = { id: number; version: string; name: string; email: string; category: string; instituicao: string; criada: string; criadaTxt: string; motivo: string; detalhe: string; provedor: string; dominio: string; sugestao: string | null; motivoSugestao: string | null };
type Msg = { texto: string; erro?: boolean };
const CAT: Record<string, string> = { servidor: "Servidor", apoiador: "Apoiador", estrangeiro: "Estrangeiro" };
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();


/** Cadastros pendentes sem e-mail entregue: filtros, edição do e-mail, sugestões e reenvio (por linha e em lote, com confirmação). */
export default function PendentesTable({ linhas: inicial }: { linhas: Linha[] }) {
  const [rows, setRows] = useState<Linha[]>(inicial);
  const [f, setF] = useState({ q: "", motivo: "", provedor: "", categoria: "", instituicao: "", dominio: "", soSug: false, soDev: false, soFila: false, soSem: false });
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<Msg | null>(null);
  const [modal, setModal] = useState<null | { acao: "sugestoes" | "reenviar"; alvo: Linha[] }>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const mostrar = (texto: string, erro = false) => { setMsg({ texto, erro }); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 7000); };
  const opts = (get: (r: Linha) => string) => { const m = new Map<string, number>(); rows.forEach((r) => { const v = get(r); if (v) m.set(v, (m.get(v) ?? 0) + 1); }); return [...m.entries()].sort((a, b) => b[1] - a[1]); };
  const visiveis = useMemo(() => rows.filter((r) =>
    (!f.q || norm(`${r.name} ${r.email}`).includes(norm(f.q))) && (!f.motivo || r.motivo === f.motivo) && (!f.provedor || r.provedor === f.provedor) && (!f.categoria || r.category === f.categoria) &&
    (!f.instituicao || r.instituicao === f.instituicao) && (!f.dominio || r.dominio === f.dominio) && (!f.soSug || r.sugestao) && (!f.soDev || r.motivo === "devolvido" || r.motivo === "suprimido") && (!f.soFila || r.motivo === "na fila") && (!f.soSem || r.motivo === "sem envio")), [rows, f]);
  const todosSel = visiveis.length > 0 && visiveis.every((r) => sel.has(r.id));
  const marcados = rows.filter((r) => sel.has(r.id));
  const comSug = marcados.filter((r) => r.sugestao);

  const setBusyOne = (id: number, on: boolean) => setBusy((b) => { const n = new Set(b); on ? n.add(id) : n.delete(id); return n; });
  const begin = (ids: number[]) => {
    if (ids.some(id => inFlight.current.has(id))) return false;
    ids.forEach(id => { inFlight.current.add(id); setBusyOne(id, true); });
    return true;
  };
  const end = (ids: number[]) => ids.forEach(id => { inFlight.current.delete(id); setBusyOne(id, false); });
  const atualizar = (id: number, p: Partial<Linha>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...p } : r)));

  async function salvar(r: Linha) {
    const novo = (edit[r.id] ?? "").trim();
    if (!begin([r.id])) return;
    const j = await chamar(`/api/admin/assinaturas/${r.id}/email`, "PATCH", { email: novo, version: r.version });
    end([r.id]);
    if (!j.ok) return mostrar(j.erro ?? "Não foi possível salvar.", true);
    atualizar(r.id, { email: j.email, version: j.version, dominio: String(j.email).split("@")[1] ?? "", sugestao: null, motivoSugestao: null, motivo: "corrigido", detalhe: "e-mail corrigido: falta reenviar a confirmação" });
    setEdit((e) => { const n = { ...e }; delete n[r.id]; return n; });
    mostrar(`E-mail de ${r.name} corrigido para ${j.email}. Use "Reenviar" para mandar a confirmação.`);
  }
  async function reenviar(r: Linha) {
    if (!begin([r.id])) return;
    const j = await chamar(`/api/admin/assinaturas/${r.id}/reenviar`, "POST");
    end([r.id]);
    if (!j.ok) return mostrar(j.erro ?? "Não foi possível reenviar.", true);
    atualizar(r.id, { motivo: "reenviado", detalhe: j.envio === "queued" ? "na fila de reenvio" : "confirmação reenviada agora" });
    mostrar(`Confirmação reenviada para ${r.email}${j.envio === "queued" ? " (ficou na fila)" : ""}.`);
  }
  async function aplicarSug(r: Linha) {
    if (!begin([r.id])) return;
    const j = await chamar("/api/admin/assinaturas/lote", "POST", { acao: "sugestoes", ids: [r.id], versions: { [r.id]: r.version } });
    end([r.id]);
    const x = j.resultados?.[0]?.r;
    if (!x?.ok) return mostrar(x?.erro ?? j.erro ?? "Não foi possível aplicar a sugestão.", true);
    atualizar(r.id, { email: x.email, version: x.version, dominio: String(x.email).split("@")[1] ?? "", sugestao: null, motivoSugestao: null, motivo: "corrigido", detalhe: "sugestão aplicada: falta reenviar a confirmação" });
    mostrar(`Sugestão aplicada: ${x.email}.`);
  }
  async function confirmarLote() {
    if (!modal) return;
    const ids = modal.alvo.map((r) => r.id); if (!begin(ids)) return;
    const j = await chamar("/api/admin/assinaturas/lote", "POST", { acao: modal.acao, ids, ...(modal.acao === "sugestoes" ? { versions: Object.fromEntries(modal.alvo.map(r => [r.id, r.version])) } : {}) });
    end(ids); setModal(null); dlg.current?.close();
    if (!j.ok || !Array.isArray(j.resultados)) return mostrar(j.erro ?? "Falha na ação em lote.", true);
    for (const x of j.resultados as { id: number; r: any }[]) {
      if (!x.r.ok) continue;
      if (modal.acao === "sugestoes") atualizar(x.id, { email: x.r.email, version: x.r.version, dominio: String(x.r.email).split("@")[1] ?? "", sugestao: null, motivoSugestao: null, motivo: "corrigido", detalhe: "sugestão aplicada: falta reenviar a confirmação" });
      else atualizar(x.id, { motivo: "reenviado", detalhe: x.r.envio === "queued" ? "na fila de reenvio" : "confirmação reenviada agora" });
    }
    setSel(new Set((j.resultados as { id: number; r: { ok: boolean } }[]).filter(x => !x.r.ok).map(x => x.id)));
    const falhas = (j.resultados as { r: any }[]).filter((x) => !x.r.ok).map((x) => x.r.erro);
    mostrar(`${j.aplicados} de ${j.total} concluídos${falhas.length ? `. Falhas: ${[...new Set(falhas)].slice(0, 3).join(" · ")}` : "."}`, falhas.length > 0 && j.aplicados === 0);
  }
  const abrir = (acao: "sugestoes" | "reenviar", alvo: Linha[]) => { if (!alvo.length) return; setModal({ acao, alvo }); setTimeout(() => dlg.current?.showModal(), 0); };

  return (
    <div>
      <div className="adm-filters" role="search">
        <label>Buscar<input type="search" placeholder="nome ou e-mail" value={f.q} onChange={(e) => setF({ ...f, q: e.target.value })} /></label>
        <label>Motivo<select value={f.motivo} onChange={(e) => setF({ ...f, motivo: e.target.value })}><option value="">Todos</option>{opts((r) => r.motivo).map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}</select></label>
        <label>Provedor que devolveu<select value={f.provedor} onChange={(e) => setF({ ...f, provedor: e.target.value })}><option value="">Todos</option>{opts((r) => r.provedor).map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}</select></label>
        <label>Categoria<select value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })}><option value="">Todas</option>{opts((r) => r.category).map(([v, n]) => <option key={v} value={v}>{CAT[v] ?? v} ({n})</option>)}</select></label>
        <label>Instituição<select value={f.instituicao} onChange={(e) => setF({ ...f, instituicao: e.target.value })}><option value="">Todas</option>{opts((r) => r.instituicao).map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}</select></label>
        <label>Domínio<select value={f.dominio} onChange={(e) => setF({ ...f, dominio: e.target.value })}><option value="">Todos</option>{opts((r) => r.dominio).map(([v, n]) => <option key={v} value={v}>{v} ({n})</option>)}</select></label>
        <label className="adm-check"><input type="checkbox" checked={f.soSug} onChange={(e) => setF({ ...f, soSug: e.target.checked })} />Só com sugestão</label>
        <label className="adm-check"><input type="checkbox" checked={f.soDev} onChange={(e) => setF({ ...f, soDev: e.target.checked })} />Só devolvidos</label>
        <label className="adm-check"><input type="checkbox" checked={f.soFila} onChange={(e) => setF({ ...f, soFila: e.target.checked })} />Só na fila</label>
        <label className="adm-check"><input type="checkbox" checked={f.soSem} onChange={(e) => setF({ ...f, soSem: e.target.checked })} />Só sem envio</label>
        <button type="button" className="adm-btn sm" onClick={() => setF({ q: "", motivo: "", provedor: "", categoria: "", instituicao: "", dominio: "", soSug: false, soDev: false, soFila: false, soSem: false })}>Limpar filtros</button>
      </div>
      <div className="adm-bar">
        <span aria-live="polite"><strong>{visiveis.length}</strong> de {rows.length} · {marcados.length} selecionado(s)</span><span className="grow" />
        <button type="button" className="adm-btn warn" disabled={comSug.length === 0} onClick={() => abrir("sugestoes", comSug)}>Aceitar sugestões ({comSug.length})</button>
        <button type="button" className="adm-btn pri" disabled={marcados.length === 0} onClick={() => abrir("reenviar", marcados)}>Reenviar selecionados ({marcados.length})</button>
      </div>
      <div className="adm-list" role="table" aria-label="Cadastros pendentes sem e-mail entregue">
        <div className="adm-row head" role="row">
          <span><input type="checkbox" aria-label="Selecionar todos os visíveis" checked={todosSel} onChange={(e) => setSel(e.target.checked ? new Set(visiveis.map((r) => r.id)) : new Set())} /></span>
          <span>Nome</span><span>E-mail digitado</span><span>Motivo</span><span>Sugestão</span><span>Ações</span>
        </div>
        {visiveis.length === 0 && <div className="adm-row"><span /><span><em>Nenhum cadastro neste filtro.</em></span></div>}
        {visiveis.map((r) => {
          const editando = r.id in edit, ocupado = busy.has(r.id);
          return (
            <article className="adm-row" role="row" key={r.id}>
              <span><input type="checkbox" aria-label={`Selecionar ${r.name}`} checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} /></span>
              <span><span className="nome">{r.name}</span><small>{r.instituicao || CAT[r.category] || r.category} · {r.criadaTxt}</small></span>
              <span>{editando ? <input type="email" value={edit[r.id]} autoFocus onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") salvar(r); if (e.key === "Escape") setEdit((x) => { const n = { ...x }; delete n[r.id]; return n; }); }} aria-label={`Novo e-mail de ${r.name}`} /> : r.email}</span>
              <span><span className={`adm-tag ${r.motivo.replace(/\s/g, "")}`}>{r.motivo}</span><small>{r.detalhe}</small></span>
              <span>{r.sugestao ? <span className="adm-sug"><strong>{r.sugestao}</strong><small>{r.motivoSugestao}</small></span> : <small>—</small>}</span>
              <span className="adm-acoes">
                {editando ? (<>
                  <button type="button" className="adm-btn sm pri" disabled={ocupado} onClick={() => salvar(r)}>Salvar</button>
                  <button type="button" className="adm-btn sm" disabled={ocupado} onClick={() => setEdit((x) => { const n = { ...x }; delete n[r.id]; return n; })}>Cancelar</button>
                </>) : (<>
                  <button type="button" className="adm-btn sm" disabled={ocupado} onClick={() => setEdit({ ...edit, [r.id]: r.email })}>Editar</button>
                  {r.sugestao && <button type="button" className="adm-btn sm warn" disabled={ocupado} onClick={() => aplicarSug(r)}>Aplicar sugestão</button>}
                  <button type="button" className="adm-btn sm pri" disabled={ocupado} onClick={() => reenviar(r)}>Reenviar</button>
                </>)}
              </span>
            </article>
          );
        })}
      </div>
      <dialog ref={dlg} className="adm-modal" onClose={() => setModal(null)}>
        {modal && <div className="in">
          <h3 style={{ margin: 0 }}>{modal.acao === "sugestoes" ? `Aceitar ${modal.alvo.length} sugestão(ões)` : `Reenviar a confirmação a ${modal.alvo.length} cadastro(s)`}</h3>
          <p className="small" style={{ margin: 0 }}>{modal.acao === "sugestoes" ? "Os e-mails abaixo serão trocados pelos sugeridos (a sugestão é recalculada no servidor ao confirmar). Depois é preciso reenviar a confirmação." : "Será enviado um novo link de confirmação para cada endereço abaixo (o anterior deixa de valer). Cadastros que já receberam há menos de 10 minutos são pulados."}</p>
          <div className="table-scroll"><table><thead><tr><th>Nome</th><th>{modal.acao === "sugestoes" ? "De" : "E-mail"}</th>{modal.acao === "sugestoes" && <th>Para</th>}</tr></thead>
            <tbody>{modal.alvo.slice(0, 50).map((r) => <tr key={r.id}><td>{r.name}</td><td>{r.email}</td>{modal.acao === "sugestoes" && <td><strong>{r.sugestao}</strong></td>}</tr>)}</tbody></table></div>
          {modal.alvo.length > 50 && <p className="small">… e mais {modal.alvo.length - 50}.</p>}
          <div className="fim"><button type="button" className="adm-btn" onClick={() => { setModal(null); dlg.current?.close(); }}>Cancelar</button><button type="button" className="adm-btn pri" onClick={confirmarLote}>{modal.acao === "sugestoes" ? "Aplicar sugestões" : "Enviar agora"}</button></div>
        </div>}
      </dialog>
      {msg && <div className={`adm-toast${msg.erro ? " err" : ""}`} role="status">{msg.texto}</div>}
    </div>
  );
}
