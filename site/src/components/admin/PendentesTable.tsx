"use client";
import { Fragment, useEffect, useRef, useState } from "react";
import { adminJsonRequest as chamar } from "@/lib/admin-request";
import { PENDING_EMAIL_STATES, pendingEmailQuery, type PendingEmailFilters, type PendingEmailReadResult, type PendingEmailRow } from "@/lib/pending-email-admin-contract";
import { readPendingEmails } from "@/lib/pending-email-admin-client";
import { pendingDetailParts } from "@/lib/pending-email-detail";
import { brasilia } from "@/lib/time";

export type Linha = PendingEmailRow;
type Msg = { texto: string; erro?: boolean };
const CAT: Record<string, string> = { servidor: "Servidor", apoiador: "Apoiador", estrangeiro: "Estrangeiro" };
// MUDAR AQUI: textos neutros do último sinal conhecido por endereço.
const STATE:Record<string,string>={clicked:"Clique registrado",opened:"Abertura registrada",delivered:"Entrega registrada",adverse:"Devolução ou bloqueio registrado",accepted:"Aceite do provedor registrado",unrecorded:"Sem registro de sinal"};
// MUDAR AQUI: o evento adverso é histórico do endereço e pode anteceder o último sinal positivo.
const detailText=(value:string)=>pendingDetailParts(value).map((part,index)=><Fragment key={index}>{part.text}{part.breakAfter&&<wbr/>}</Fragment>);
const emptyFilters=()=>({q:"",state:"",provider:"",category:"",institution:"",domain:"",hasSuggestion:false,hasAdverse:false,queued:false,withoutAcceptance:false});
type Props={actorScope:string;initial:PendingEmailReadResult|null;initialError?:string};
export default function PendentesTable(props:Props){return <PendingContext key={props.actorScope} {...props}/>;}
function PendingContext({initial,initialError}:Props){
  const [data,setData]=useState<PendingEmailReadResult|null>(initial);
  const [rows,setRows]=useState<Linha[]>(initial?.rows??[]);
  const [f,setF]=useState(emptyFilters);
  const [before,setBefore]=useState<string|undefined>();
  const [previous,setPrevious]=useState<(string|undefined)[]>([]);
  const [confirmedPage,setConfirmedPage]=useState(1);
  const [attempt,setAttempt]=useState(0),[loading,setLoading]=useState(false),[obsolete,setObsolete]=useState(false);
  const [readError,setReadError]=useState(initialError?"Não foi possível carregar a consulta. Atualize para tentar novamente.":"");
  const filters:PendingEmailFilters={};if(f.q)filters.q=f.q;if(f.state)filters.state=f.state as PendingEmailFilters["state"];if(f.category)filters.category=f.category as PendingEmailFilters["category"];if(f.provider)filters.provider=f.provider;if(f.institution)filters.institution=f.institution;if(f.domain)filters.domain=f.domain;if(f.hasSuggestion)filters.hasSuggestion="yes";if(f.hasAdverse)filters.adverseOrSuppressed="yes";if(f.withoutAcceptance)filters.hasAcceptance="no";if(f.queued)filters.queued="yes";
  const query=pendingEmailQuery({filters,before,limit:50});
  const [confirmed,setConfirmed]=useState(initial?query:"");
  const csvParams=new URLSearchParams(confirmed);csvParams.delete("before");csvParams.delete("limit");csvParams.set("formato","csv");
  const sequence=useRef(0);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [edit, setEdit] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const [msg, setMsg] = useState<Msg | null>(null);
  const [modal, setModal] = useState<null | { acao: "sugestoes" | "reenviar"; alvo: Linha[] }>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const inFlight = useRef(new Set<number>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const mostrar = (texto: string, erro = false) => { setMsg({ texto, erro }); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(null), 7000); };
  const stale=obsolete||confirmed!==query;
  const readLocked=Object.keys(edit).length>0||busy.size>0||modal!==null;
  const canMutate=!!data&&!loading&&!stale&&!readError;
  const opts=(key:keyof PendingEmailReadResult["facets"])=>{
    const values=data?.facets[key]??[],active=f[key];
    if(key==="state")return PENDING_EMAIL_STATES.map(value=>values.find(v=>v.value===value)??{value,count:0});
    return active&&!values.some(v=>v.value===active)?[...values,{value:active,count:0}]:values;
  };
  const visiveis=rows;
  const changeFilters=(next:ReturnType<typeof emptyFilters>)=>{if(readLocked)return;setLoading(true);setAttempt(n=>n+1);setF(next);setBefore(undefined);setPrevious([]);setSel(new Set());};
  useEffect(()=>{
    const controller=new AbortController(),seq=++sequence.current;setLoading(true);
    const timer=setTimeout(()=>{void readPendingEmails(new URLSearchParams(query),controller.signal).then(result=>{
      if(controller.signal.aborted||seq!==sequence.current)return;
      setLoading(false);
      if(result.ok){setData(result.data);setRows(result.data.rows);setConfirmed(query);setConfirmedPage(previous.length+1);setObsolete(false);setReadError("");setSel(new Set());}
      else if(result.kind!=="aborted"){
        const clear=result.kind==="invalid"||result.kind==="http"&&(result.status===401||result.status===403);
        if(clear){setData(null);setRows([]);setSel(new Set());setConfirmed("");}
        setReadError(clear?"Sua sessão não permite consultar estes dados ou a resposta não pôde ser validada.":"Não foi possível atualizar a consulta. Os dados anteriores foram preservados; tente novamente.");
      }
    });},200);
    return()=>{clearTimeout(timer);controller.abort();};
  },[query,attempt]);
  useEffect(()=>()=>{clearTimeout(timer.current);},[]);
  const todosSel = visiveis.length > 0 && visiveis.every((r) => sel.has(r.id));
  const marcados = rows.filter((r) => sel.has(r.id));
  const comSug = marcados.filter((r) => r.sugestao);

  const setBusyOne = (id: number, on: boolean) => setBusy((b) => { const n = new Set(b); on ? n.add(id) : n.delete(id); return n; });
  const begin = (ids: number[]) => {
    if (!canMutate || ids.some(id => inFlight.current.has(id))) return false;
    setObsolete(true);
    ids.forEach(id => { inFlight.current.add(id); setBusyOne(id, true); });
    return true;
  };
  const end = (ids: number[]) => ids.forEach(id => { inFlight.current.delete(id); setBusyOne(id, false); });
  // Keep the original address evidence as an explicitly stale snapshot. A mutation never rebases it onto a corrected e-mail.
  const atualizar = (_id:number,_p:Partial<Linha>)=>{setObsolete(true);setSel(new Set());};

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
    <div role="region" aria-label="Consulta de cadastros pendentes" aria-busy={loading}>
      <div className="adm-filters" role="search">
        <label>Buscar<input type="search" placeholder="nome ou e-mail" value={f.q} maxLength={80} disabled={readLocked} onChange={(e) => changeFilters({ ...f, q: e.target.value })} /></label>
        <label>Motivo<select disabled={readLocked} value={f.state} onChange={(e)=>changeFilters({...f,state:e.target.value})}><option value="">Todos</option>{opts("state").map(({value,count})=><option key={value} value={value}>{STATE[value]??value} ({count})</option>)}</select></label>
        {/* MUDAR AQUI: filtro abrange todos os provedores com registro, não somente devoluções. */}
        <label>Provedor registrado<select disabled={readLocked} value={f.provider} onChange={(e)=>changeFilters({...f,provider:e.target.value})}><option value="">Todos</option>{opts("provider").map(({value,count})=><option key={value} value={value}>{value} ({count})</option>)}</select></label>
        <label>Categoria<select disabled={readLocked} value={f.category} onChange={(e)=>changeFilters({...f,category:e.target.value})}><option value="">Todas</option>{opts("category").map(({value,count})=><option key={value} value={value}>{CAT[value]??value} ({count})</option>)}</select></label>
        <label>Instituição<select disabled={readLocked} value={f.institution} onChange={(e)=>changeFilters({...f,institution:e.target.value})}><option value="">Todas</option>{opts("institution").map(({value,count})=><option key={value} value={value}>{value} ({count})</option>)}</select></label>
        <label>Domínio<select disabled={readLocked} value={f.domain} onChange={(e)=>changeFilters({...f,domain:e.target.value})}><option value="">Todos</option>{opts("domain").map(({value,count})=><option key={value} value={value}>{value} ({count})</option>)}</select></label>
        <label className="adm-check"><input type="checkbox" disabled={readLocked} checked={f.hasSuggestion} onChange={(e)=>changeFilters({...f,hasSuggestion:e.target.checked})}/>Só com sugestão</label>
        <label className="adm-check"><input type="checkbox" disabled={readLocked} checked={f.hasAdverse} onChange={(e)=>changeFilters({...f,hasAdverse:e.target.checked})}/>Só devolvidos</label>
        <label className="adm-check"><input type="checkbox" disabled={readLocked} checked={f.queued} onChange={(e)=>changeFilters({...f,queued:e.target.checked})}/>Só na fila</label>
        {/* MUDAR AQUI: ausência de aceite registrado não significa ausência de envio. */}
        <label className="adm-check"><input type="checkbox" disabled={readLocked} checked={f.withoutAcceptance} onChange={(e)=>changeFilters({...f,withoutAcceptance:e.target.checked})}/>Só sem registro de aceite</label>
        <button type="button" className="adm-btn sm" disabled={readLocked} onClick={()=>changeFilters(emptyFilters())}>Limpar filtros</button>
      </div>
      <div className="adm-bar">
        <span aria-live="polite"><strong>{visiveis.length}</strong> nesta página · {data?.summary.filtered.total??"—"} neste filtro · {data?.summary.global.total??"—"} pendentes no total · {marcados.length} selecionado(s) nesta página</span><span className="grow" />
        <button type="button" className="adm-btn warn" disabled={!canMutate || comSug.length === 0} onClick={() => abrir("sugestoes", comSug)}>Aceitar sugestões ({comSug.length})</button>
        <button type="button" className="adm-btn pri" disabled={!canMutate || marcados.length === 0} onClick={() => abrir("reenviar", marcados)}>Reenviar selecionados ({marcados.length})</button>
      </div>
      {/* MUDAR AQUI: interpretação e data da consulta, não comprovação de recebimento da confirmação atual. */}
      <p className="small">Último sinal conhecido por endereço, considerando os registros disponíveis. As contagens das opções dos filtros são globais. O histórico do endereço não comprova a entrega ou leitura da confirmação deste cadastro. Sem registro não significa que a mensagem não foi enviada ou recebida.</p>
      {data&&<p className="small">Consulta de {brasilia(data.asOf,true)}. Cada página reflete sua própria consulta.</p>}
      {data&&<p className="small">Neste filtro: {Object.entries(data.summary.filtered.byState).map(([key,count])=>`${STATE[key]??key}: ${count}`).join(" · ")}. Suprimidos: {data.summary.filtered.suppressed} · Na fila: {data.summary.filtered.queued}.</p>}
      {readError&&<p className="v2-aviso erro" role="alert">{readError}</p>}
      {stale&&data&&<p className="small" role="status">Consulta anterior. Atualize antes de executar outra ação.</p>}
      {readLocked&&<p className="small">Conclua ou cancele a edição/ação aberta antes de trocar a consulta.</p>}
      <div className="adm-bar">
        <button type="button" className="adm-btn sm" disabled={readLocked||loading} onClick={()=>{setLoading(true);setAttempt(n=>n+1);}}>Atualizar consulta</button>
        <button type="button" className="adm-btn sm" disabled={readLocked||loading||stale||previous.length===0} onClick={()=>{setLoading(true);const stack=previous.slice();setBefore(stack.pop());setPrevious(stack);setSel(new Set());}}>‹ Anterior</button>
        <span>Página {confirmedPage}</span>
        {canMutate&&<a className="adm-btn sm" href={`/api/admin/emails/pendentes?${csvParams}`}>Baixar CSV do filtro</a>}
        <button type="button" className="adm-btn sm" disabled={readLocked||loading||stale||!data?.next} onClick={()=>{if(data?.next){setLoading(true);setPrevious(p=>[...p,before]);setBefore(data.next);setSel(new Set());}}}>Próxima ›</button>
      </div>
      <div className="adm-list" role="table" aria-label="Cadastros pendentes e sinais registrados por endereço">
        <div className="adm-row head" role="row">
          <span><input type="checkbox" aria-label="Selecionar todos os visíveis" disabled={!canMutate} checked={todosSel} onChange={(e) => setSel(e.target.checked ? new Set(visiveis.map((r) => r.id)) : new Set())} /></span>
          <span>Nome</span><span>E-mail digitado</span><span>Motivo</span><span>Sugestão</span><span>Ações</span>
        </div>
        {visiveis.length === 0 && <div className="adm-row"><span /><span><em>Nenhum cadastro neste filtro.</em></span></div>}
        {visiveis.map((r) => {
          const editando = r.id in edit, ocupado = busy.has(r.id) || !canMutate;
          return (
            <article className="adm-row" role="row" key={r.id}>
              <span><input type="checkbox" aria-label={`Selecionar ${r.name}`} disabled={!canMutate} checked={sel.has(r.id)} onChange={(e) => setSel((s) => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n; })} /></span>
              <span><span className="nome">{r.name}</span><small>{r.instituicao || CAT[r.category] || r.category} · {r.criadaTxt}</small></span>
              <span>{editando ? <input type="email" value={edit[r.id]} autoFocus onChange={(e) => setEdit({ ...edit, [r.id]: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter") salvar(r); if (e.key === "Escape") setEdit((x) => { const n = { ...x }; delete n[r.id]; return n; }); }} aria-label={`Novo e-mail de ${r.name}`} /> : r.email}</span>
              <span><span className={`adm-tag ${r.motivo.replace(/\s/g, "")}`}>{r.motivo}</span><small data-pending-detail="true">{detailText(r.detalhe)}</small>{r.evidence.lastSignal&&<small>Registrado em {brasilia(r.evidence.lastSignal.at,true)} · {r.evidence.lastSignal.provider}</small>}{r.evidence.lastAdverse&&<small data-pending-adverse="true">Evento adverso no histórico do endereço: {r.evidence.lastAdverse.type} · {r.evidence.lastAdverse.provider} · {brasilia(r.evidence.lastAdverse.at,true)} · <span data-pending-adverse-reason="true">{r.evidence.lastAdverse.reason?detailText(r.evidence.lastAdverse.reason):"Sem detalhe registrado"}</span></small>}{r.suppressed&&<small>Supressão registrada: {detailText(r.suppressionReason??"sem motivo informado")}</small>}{r.queued&&<small>Na fila registrada</small>}</span>
              <span>{r.sugestao ? <span className="adm-sug"><strong>{detailText(r.sugestao)}</strong><small>{r.motivoSugestao===null?null:detailText(r.motivoSugestao)}</small></span> : <small>—</small>}</span>
              <span className="adm-acoes">
                {editando ? (<>
                  <button type="button" className="adm-btn sm pri" disabled={ocupado} onClick={() => salvar(r)}>Salvar</button>
                  <button type="button" className="adm-btn sm" disabled={busy.has(r.id)} onClick={() => setEdit((x) => { const n = { ...x }; delete n[r.id]; return n; })}>Cancelar</button>
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
