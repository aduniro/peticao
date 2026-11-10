"use client";
import { Fragment,useEffect,useRef,useState,type FormEvent } from "react";
import { mailDeliveryQuery,mailDeliverySearch,type MailDeliveryFilters,type MailDeliveryReadResult } from "@/lib/mail-delivery-admin-contract";
import { readMailDelivery } from "@/lib/delivery-admin-client";
import { pendingDetailParts } from "@/lib/pending-email-detail";
import { brasilia } from "@/lib/time";
// MUDAR AQUI: sinais registrados não são prova de leitura humana ou entrega da confirmação atual.
const SIT:Record<string,string>={clicou:"Clique registrado",abriu:"Abertura registrada",entregue:"Entrega registrada",devolvido:"Evento adverso registrado",aceito:"Aceite registrado",sem_registro:"Sem registro"};
type Props={actorScope:string;initial:MailDeliveryReadResult|null;initialError?:string;initialQuery:string};
type Draft={busca:string;situacao:string;cadastro:string;categoria:string;provedor:string};
const detail=(value:string)=>pendingDetailParts(value).map((part,index)=><Fragment key={index}>{part.text}{part.breakAfter&&<wbr/>}</Fragment>);
const time=(value:string)=>value?brasilia(value):"—";
function filters(draft:Draft):MailDeliveryFilters{const out:MailDeliveryFilters={};if(draft.busca)out.busca=draft.busca;if(draft.situacao)out.situacao=draft.situacao as MailDeliveryFilters["situacao"];if(draft.cadastro)out.cadastro=draft.cadastro as MailDeliveryFilters["cadastro"];if(draft.categoria)out.categoria=draft.categoria as MailDeliveryFilters["categoria"];if(draft.provedor)out.provedor=draft.provedor;return out;}
export default function EntregasConsulta(props:Props){return <DeliveryContext key={`${props.actorScope}\u001f${props.initialQuery}\u001f${props.initial?.asOf??props.initialError??""}`} {...props}/>;}
function DeliveryContext({initial,initialError,initialQuery}:Props){
  const parsed=mailDeliverySearch(new URLSearchParams(initialQuery)),original=parsed.ok?parsed.options.filters??{}:{};
  const [draft,setDraft]=useState<Draft>({busca:original.busca??"",situacao:original.situacao??"",cadastro:original.cadastro??"",categoria:original.categoria??"",provedor:original.provedor??""});
  const [request,setRequest]=useState(initialQuery),[confirmed,setConfirmed]=useState(initial?initialQuery:""),[data,setData]=useState(initial),[loading,setLoading]=useState(false),[attempt,setAttempt]=useState(0);
  const [error,setError]=useState(initialError==="invalid"?"Parâmetros inválidos na consulta. Corrija os filtros e clique em Filtrar.":initialError?"Não foi possível carregar esta consulta. Tente novamente.":"");
  const sequence=useRef(0),wanted=mailDeliverySearch(new URLSearchParams(request));
  const draftQuery=mailDeliveryQuery({filters:filters(draft)}),activeQuery=wanted.ok?mailDeliveryQuery({filters:wanted.options.filters}):null;
  const unapplied=draftQuery!==activeQuery,stale=request!==confirmed||!!error;
  const csv=new URLSearchParams(confirmed);csv.delete("pagina");csv.delete("limite");csv.set("formato","csv");
  useEffect(()=>{
    const controller=new AbortController(),seq=++sequence.current;setLoading(true);
    void readMailDelivery(new URLSearchParams(request),controller.signal).then(result=>{
      if(controller.signal.aborted||seq!==sequence.current)return;setLoading(false);
      if(result.ok){setData(result.data);setConfirmed(request);setError("");return;}
      if(result.kind==="aborted")return;
      const parsedRequest=mailDeliverySearch(new URLSearchParams(request)),invalidQuery=!parsedRequest.ok||parsedRequest.format!=="json";
      if(result.kind==="invalid"||result.kind==="http"&&(result.status===401||result.status===403)){setData(null);setConfirmed("");setError(invalidQuery?"Parâmetros inválidos na consulta. Corrija os filtros e clique em Filtrar.":result.kind==="http"?"Sua sessão não permite consultar estes dados.":"A resposta da consulta não pôde ser validada. Tente novamente.");}
      else setError("Não foi possível atualizar. A consulta anterior foi preservada. Tente novamente.");
    });return()=>controller.abort();
  },[request,attempt]);
  const read=(query:string)=>{setLoading(true);setRequest(query);setAttempt(n=>n+1);if(mailDeliverySearch(new URLSearchParams(query)).ok)history.replaceState(null,"",query?`?${query}`:location.pathname);};
  const submit=(event:FormEvent)=>{event.preventDefault();read(mailDeliveryQuery({filters:filters(draft),page:1,limit:wanted.ok?wanted.options.limit??50:50}));};
  const navigate=(page:number)=>{if(!data||loading||stale||unapplied)return;const active=mailDeliverySearch(new URLSearchParams(confirmed));if(active.ok)read(mailDeliveryQuery({...active.options,page}));};
  const pages=data?Math.max(1,Math.ceil(data.total/data.limite)):1;
  return <div role="region" aria-label="Consulta de entregas registradas" aria-busy={loading}>
    {/* MUDAR AQUI: unidade de inventário e limites das evidências agregadas. */}
    <p className="small">Cada linha representa um cadastro ou um endereço avulso sem cadastro. Um endereço pode aparecer em mais de um cadastro; as linhas não são pessoas únicas. Os sinais são o histórico do endereço e não comprovam a entrega ou leitura da confirmação deste cadastro. Aceite do provedor não comprova entrega. <strong>O CPF não aparece aqui.</strong></p>
    <form method="get" onSubmit={submit} style={{margin:"10px 0",display:"flex",gap:8,flexWrap:"wrap"}}>
      <input name="busca" value={draft.busca} maxLength={80} onChange={e=>setDraft({...draft,busca:e.target.value})} placeholder="Nome ou e-mail"/>
      <select name="situacao" value={draft.situacao} onChange={e=>setDraft({...draft,situacao:e.target.value})}><option value="">Toda situação</option>{Object.entries(SIT).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select>
      <select name="cadastro" value={draft.cadastro} onChange={e=>setDraft({...draft,cadastro:e.target.value})}><option value="">Todo cadastro</option><option value="aguardando">Aguardando confirmação</option><option value="confirmado">Confirmado</option><option value="sem">Sem cadastro</option></select>
      <select name="categoria" value={draft.categoria} onChange={e=>setDraft({...draft,categoria:e.target.value})}><option value="">Toda categoria</option><option value="servidor">Servidor</option><option value="apoiador">Apoiador</option><option value="estrangeiro">Estrangeiro</option></select>
      <input name="provedor" value={draft.provedor} maxLength={100} onChange={e=>setDraft({...draft,provedor:e.target.value})} placeholder="Provedor (ex.: ses)" size={14}/>
      <button disabled={loading&&!unapplied}>Filtrar</button>{data&&!loading&&!stale&&!unapplied&&<a href={`/api/admin/emails/entregas?${csv}`}>Baixar CSV ({data.total})</a>}
    </form>
    {unapplied&&<p className="small" role="status">Filtros ainda não aplicados. Clique em Filtrar para consultar.</p>}
    {loading&&<p className="small" role="status">Consultando registros…</p>}
    {error&&<p className="v2-aviso erro" role="alert">{error}</p>}
    {stale&&data&&<p className="small" role="status">Consulta anterior; os filtros solicitados ainda não foram confirmados.</p>}
    {!!error&&<button type="button" disabled={loading} onClick={()=>read(request)}>Tentar consulta novamente</button>}
    {data&&<>
      <p className="small">{data.total} registro(s) neste filtro · página {data.pagina} de {pages} · {data.summary.registrations} cadastro(s) ({data.summary.pending} aguardando confirmação e {data.summary.confirmed} confirmado(s)) · {data.summary.unregisteredAddresses} endereço(s) avulso(s).</p>
      <p className="small">Inventário global: {data.inventory.registrations} cadastro(s) e {data.inventory.unregisteredAddresses} endereço(s) avulso(s). Consulta de {brasilia(data.asOf,true)}; cada página tem sua própria consulta. {data.providerScope?`Sinais recortados para o provedor ${data.providerScope}.`:"Sinais de todos os provedores registrados."}</p>
      {/* MUDAR AQUI: datas históricas não medem o intervalo desde a solicitação atual. */}
      <p className="small">Entrega, abertura e clique mostram os primeiros horários registrados no histórico consultado. A situação considera o último sinal conhecido, que pode suceder um evento adverso antigo. Ausência de abertura não comprova spam; abertura ou clique registrados não comprovam uma ação humana. No CSV, a contagem de envios representa registros legados de aceite, não mensagens únicas.</p>
      {/* MUDAR AQUI: último aceite e provedores de eventos sem aceite são fatos distintos. */}
      <div style={{overflowX:"auto"}}><table className="adm-table">
        <thead><tr><th>Nome</th><th>E-mail</th><th>Categoria</th><th>Instituição / cargo</th><th>Local</th><th>Cadastro</th><th>WhatsApp</th><th>Situação do e-mail</th><th>Último aceite registrado</th><th>Entregue</th><th>Aberto</th><th>Clicou</th><th>Devolução</th></tr></thead>
        <tbody>{data.linhas.map(row=><tr key={row.recordKey}>
          <td>{row.nome||<em>(sem cadastro)</em>}</td><td>{row.email}</td><td>{row.categoria||"—"}</td>
          <td>{[row.instituicao,row.campus,row.cargo].filter(Boolean).join(" · ")||"—"}</td><td>{[row.cidadeUf,row.pais].filter(Boolean).join(" · ")||"—"}</td>
          <td>{row.cadastro||"—"}{row.cadastradoEm?<><br/><span className="small">{time(row.cadastradoEm)}</span></>:null}</td>
          <td>{row.evidence.contactState==="unavailable"?"Contato indisponível":row.evidence.contactState==="withheld_no_opt_in"?"Sem consentimento registrado":row.whatsapp||"—"}</td>
          <td><strong>{SIT[row.situacao]}</strong></td>
          <td>{row.ultimoEnvio?time(row.ultimoEnvio):<span className="small">Sem aceite registrado</span>}{row.ultimoTipo?<><br/><span className="small">{row.ultimoTipo}</span></>:null}{row.provedores?<><br/><span className="small">Provedores registrados: {detail(row.provedores)}</span></>:null}</td>
          <td>{time(row.entregueEm)}</td><td>{time(row.abertoEm)}</td><td>{time(row.clicouEm)}</td>
          <td>{row.devolucao?<>{row.devolucao}<br/><span className="small">Evento no histórico do endereço · {time(row.devolucaoEm)}</span><br/><span className="small" data-delivery-adverse-reason="true">{detail(row.devolucaoMotivo)}</span></>:"—"}</td>
        </tr>)}{!data.linhas.length&&<tr><td colSpan={13}>Nenhum resultado.</td></tr>}</tbody>
      </table></div>
      <p>{data.pagina>1&&<a href="#" aria-disabled={loading||stale||unapplied} onClick={event=>{event.preventDefault();navigate(data.pagina-1);}}>← Anterior</a>}{" "}{data.pagina<pages&&<a href="#" aria-disabled={loading||stale||unapplied} onClick={event=>{event.preventDefault();navigate(data.pagina+1);}}>Próxima →</a>}</p>
    </>}
  </div>;
}
