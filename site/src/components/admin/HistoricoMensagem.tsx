"use client";
import { useEffect,useId,useRef,useState } from "react";
import { brasilia } from "@/lib/time";
import { readHistoryMetadata } from "@/lib/mail-history-admin-client";
import type { HistoryAttempt,HistoryDetail,HistoryEvent } from "@/lib/mail-history-admin-contract";
const STATUS:Record<string,string>={prepared:"Aguardando envio",queued:"Aguardando envio",sending:"Envio em andamento",accepted:"Aceita pelo provedor",rejected:"Recusada",indeterminate:"Resultado a conferir"};
const EVENTS:Record<string,string>={delivered:"Entrega informada pelo provedor",opened:"Abertura registrada",clicked:"Clique registrado",hard_bounce:"Devolução permanente registrada",soft_bounce:"Devolução temporária registrada",blocked:"Bloqueio registrado",complaint:"Reclamação registrada"};
const time=(value:string|null)=>value?brasilia(value,true):"—";
type Page={total:number;next:string|null;asOf:string};
function append<T extends {id:string}>(old:T[],extra:T[]):T[]{const seen=new Set(old.map(row=>row.id));return[...old,...extra.filter(row=>{if(seen.has(row.id))return false;seen.add(row.id);return true;})];}
export default function HistoricoMensagem(props:{recordKey:string;actorScope:string;onUnauthorized?:()=>void}){return <HistoryContext key={`${props.actorScope}\u001f${props.recordKey}`} {...props}/>;}
function HistoryContext({recordKey,onUnauthorized}:{recordKey:string;actorScope:string;onUnauthorized?:()=>void}){
  const titleId=useId(),dialog=useRef<HTMLDialogElement>(null),pending=useRef<AbortController|null>(null);
  const [data,setData]=useState<HistoryDetail|null>(null),[attempts,setAttempts]=useState<HistoryAttempt[]>([]),[events,setEvents]=useState<HistoryEvent[]>([]);
  const [attemptPage,setAttemptPage]=useState<Page|null>(null),[eventPage,setEventPage]=useState<Page|null>(null),[error,setError]=useState<string|null>(null),[busy,setBusy]=useState(false);
  useEffect(()=>()=>{pending.current?.abort();pending.current=null;},[]);
  const clear=()=>{setData(null);setAttempts([]);setEvents([]);setAttemptPage(null);setEventPage(null);};
  const close=()=>{pending.current?.abort();pending.current=null;dialog.current?.close();setBusy(false);clear();setError(null);};
  const denied=(status:number|undefined)=>{if(status!==401&&status!==403)return false;clear();setError("Sua sessão não permite consultar este histórico.");onUnauthorized?.();if(status===401)window.location.assign("/admin");return true;};
  const load=async()=>{
    if(pending.current)return;const active=new AbortController();pending.current=active;setBusy(true);clear();setError(null);dialog.current?.showModal();
    try{const result=await readHistoryMetadata(new URLSearchParams({id:recordKey}),active.signal);if(pending.current!==active)return;
      if(!result.ok){if(result.kind!=="aborted"&&!denied(result.status))setError("Não foi possível carregar o histórico. Feche e tente novamente.");return;}
      if(result.mode!=="detail"){setError("A resposta do histórico não pôde ser validada.");return;}
      setData(result.data);setAttempts(result.data.attempts);setEvents(result.data.events);setAttemptPage({total:result.data.attemptsPage.total,next:result.data.attemptsPage.next,asOf:result.data.asOf});setEventPage({total:result.data.eventsPage.total,next:result.data.eventsPage.next,asOf:result.data.asOf});
    }catch{if(pending.current===active)setError("Não foi possível carregar o histórico. Feche e tente novamente.");}finally{if(pending.current===active){pending.current=null;setBusy(false);}}
  };
  const more=async(collection:"attempts"|"events")=>{
    const page=collection==="attempts"?attemptPage:eventPage;if(!page?.next||pending.current||data?.source!=="message")return;
    const active=new AbortController();pending.current=active;setBusy(true);setError(null);
    try{const result=await readHistoryMetadata(new URLSearchParams({id:recordKey,collection,before:page.next,limit:"100"}),active.signal);if(pending.current!==active)return;
      if(!result.ok){if(result.kind!=="aborted"&&!denied(result.status)){if(result.kind==="invalid")clear();setError("Não foi possível carregar a continuação. Tente novamente.");}return;}
      if(result.mode!=="collection"||result.data.collection!==collection){clear();setError("A resposta do histórico não pôde ser validada.");return;}
      const nextPage={total:result.data.total,next:result.data.next,asOf:result.data.asOf};
      if(result.data.collection==="attempts"){const extra=result.data.items;setAttempts(old=>append(old,extra));setAttemptPage(nextPage);}else{const extra=result.data.items;setEvents(old=>append(old,extra));setEventPage(nextPage);}
    }catch{if(pending.current===active)setError("Não foi possível carregar a continuação. Tente novamente.");}finally{if(pending.current===active){pending.current=null;setBusy(false);}}
  };
  return <>
    <button type="button" className="adm-btn sm" disabled={busy} onClick={load}>Histórico</button>
    <dialog ref={dialog} className="adm-modal" aria-labelledby={titleId} onCancel={close} data-testid="mail-message-detail">
      <div className="in" aria-busy={busy}>
        <div className="adm-bar"><h3 id={titleId}>Histórico da mensagem</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div>
        {error?<p className="v2-aviso erro" role="alert">{error}</p>:null}
        {data?<>
          <p><strong>{data.record.to_addr}</strong><br/>{data.record.kind} · {time(data.record.created_at)}</p>
          {/* MUDAR AQUI: o registro legado é a tentativa real, não uma mensagem reconstruída. */}
          {data.source==="legacy_attempt"?<><p>Registro anterior: uma tentativa antiga, sem mensagem original arquivada.</p><p>Provedor: {data.record.provider} · Remetente: {data.record.from_addr??"—"} · Resultado registrado: {data.record.status}.</p></>:<p>{STATUS[data.record.status]??data.record.status}. O aceite pelo provedor não comprova entrega ao destinatário.</p>}
          <p className="small">Consulta de {time(data.asOf)}. Cada continuação reflete sua própria consulta.</p>
          {data.source==="message"?<>
            <h4>Tentativas</h4>
            {attempts.length?<div className="table-scroll"><table style={{minWidth:680}}><thead><tr><th>Início</th><th>Provedor</th><th>Remetente</th><th>Resultado</th><th>Fim</th><th>ID no provedor</th><th>Erro</th></tr></thead><tbody>{attempts.map(a=><tr key={a.id}><td>{time(a.started_at)}</td><td>{a.provider}</td><td>{a.from_addr}</td><td>{STATUS[a.state]??a.state}</td><td>{time(a.finished_at)}</td><td>{a.provider_id??"—"}</td><td>{a.error_code??"—"}</td></tr>)}</tbody></table></div>:<p>Nenhuma tentativa vinculada.</p>}
            {attemptPage?<p className="small">{attempts.length} tentativa(s) carregada(s) · total da última consulta: {attemptPage.total} · {time(attemptPage.asOf)}.</p>:null}
            {attemptPage?.next?<button type="button" className="adm-btn sm" disabled={busy} onClick={()=>more("attempts")}>Carregar mais tentativas</button>:null}
            <h4>Eventos vinculados</h4>
            {events.length?<ol>{events.map(e=><li key={e.id}>{time(e.occurred_at)} · {EVENTS[e.event_type]??e.event_type} · {e.provider}</li>)}</ol>:<p>Nenhum evento vinculado. A ausência de registro não comprova que a mensagem deixou de ser entregue.</p>}
            {eventPage?<p className="small">{events.length} evento(s) carregado(s) · total da última consulta: {eventPage.total} · {time(eventPage.asOf)}.</p>:null}
            {eventPage?.next?<button type="button" className="adm-btn sm" disabled={busy} onClick={()=>more("events")}>Carregar mais eventos</button>:null}
          </>:null}
        </>:null}
      </div>
    </dialog>
  </>;
}
