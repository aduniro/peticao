"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { RecoveryRow } from "@/lib/mail/recovery";
import { brasilia } from "@/lib/time";

const LABEL="Concluir fila sem reenviar";
const NOTICE="A fila será concluída com base no aceite já registrado pelo provedor. Nenhum e-mail será reenviado. Isso não comprova entrega ao destinatário.";
const NETWORK="Falha de rede. Confira o estado da fila antes de tentar novamente.";
const FAILURE="Não foi possível concluir a fila. Atualize a página para conferir o estado atual.";
const LOAD_FAILURE="Não foi possível carregar a lista. Tente novamente.";
async function request(url:string,init:RequestInit={}) {
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
  try {const response=await fetch(url,{...init,credentials:"same-origin",cache:"no-store",signal:controller.signal});return{response,data:await response.json()};}
  finally{clearTimeout(timer);}
}
const validRows=(raw:unknown):raw is RecoveryRow[]=>Array.isArray(raw)&&raw.length<=20&&raw.every(r=>r&&Number.isSafeInteger(r.queueId)&&r.queueId>0&&typeof r.kind==="string"&&r.kind.length<=100&&typeof r.toAddr==="string"&&r.toAddr.length<=254&&typeof r.acceptedAt==="string"&&Number.isFinite(Date.parse(r.acceptedAt)));
/** Only wire after approval of AV-10 and the complementary labels/error copy. No automatic POST/retry. */
export default function RecuperarFila({initial,next:initialNext,names}:{initial:RecoveryRow[];next:number|null;names:Record<string,string>}) {
  const router=useRouter(),dialog=useRef<HTMLDialogElement>(null),singleFlight=useRef(false);
  const [rows,setRows]=useState(initial),[next,setNext]=useState(initialNext),[target,setTarget]=useState<RecoveryRow|null>(null);
  const [busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[loadError,setLoadError]=useState<string|null>(null);
  useEffect(()=>{setRows(initial);setNext(initialNext);},[initial,initialNext]);
  const auth=(status:number,data:any)=>{
    if(status===401){window.location.assign("/admin");return true;}
    if(status===403&&data?.erro==="stepup"){window.location.assign("/admin/confirmar?volta=%2Fadmin%2Femails");return true;}
    return false;
  };
  const close=()=>{if(singleFlight.current)return;dialog.current?.close();setTarget(null);setError(null);};
  const finished=(id:number)=>{dialog.current?.close();setTarget(null);setError(null);setRows(previous=>previous.filter(r=>r.queueId!==id));document.getElementById("fila")?.focus({preventScroll:true});router.refresh();};
  const confirm=async()=>{
    if(singleFlight.current||!target)return;singleFlight.current=true;setBusy(true);setError(null);const id=target.queueId;
    try{
      const {response,data}=await request("/api/admin/emails/recuperacao",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({id})});
      if(auth(response.status,data))return;
      if(response.ok&&data?.ok===true&&data.queueId===id){finished(id);return;}
      setError(FAILURE);
    }catch(error){
      // A lost response is not proof of failure. Read status, never POST again automatically.
      try{const {response,data}=await request(`/api/admin/emails/recuperacao?id=${id}`);if(auth(response.status,data))return;if(response.ok&&data?.ok===true&&data.reason==="already_settled"){finished(id);return;}}catch{/* Preserve the row and the uncertainty. */}
      setError(error instanceof SyntaxError?FAILURE:NETWORK);
    }finally{singleFlight.current=false;setBusy(false);}
  };
  const more=async()=>{
    if(singleFlight.current||next===null)return;const before=next;singleFlight.current=true;setBusy(true);setLoadError(null);
    try{
      const {response,data}=await request(`/api/admin/emails/recuperacao?before=${before}&limit=10`);
      if(auth(response.status,data))return;
      if(!response.ok||data?.ok!==true||!validRows(data.records)||data.records.some((r:RecoveryRow)=>r.queueId>=before)||data.next!==null&&(!Number.isSafeInteger(data.next)||data.next<=0||data.next>=before))throw new Error("invalid_page");
      setRows(previous=>{const merged=new Map(previous.map(r=>[r.queueId,r]));for(const row of data.records)if(!merged.has(row.queueId))merged.set(row.queueId,row);return[...merged.values()];});setNext(data.next);
    }catch{setLoadError(LOAD_FAILURE);}finally{singleFlight.current=false;setBusy(false);}
  };
  if(!rows.length&&next===null)return null;
  return <section data-testid="mail-recovery" aria-busy={busy}>
    <h3>{LABEL}</h3>
    <div className="table-scroll"><table>
      <thead><tr><th>ID</th><th>Tipo</th><th>E-mail</th><th>Data do aceite</th><th>{LABEL}</th></tr></thead>
      <tbody>{rows.map(row=><tr key={row.queueId} data-queue-id={row.queueId}><td>{row.queueId}</td><td>{names[row.kind]??row.kind}</td><td>{row.toAddr}</td><td>{brasilia(row.acceptedAt)}</td><td><button type="button" className="adm-btn sm" disabled={busy} onClick={()=>{if(singleFlight.current)return;setError(null);setTarget(row);dialog.current?.showModal();}}>{LABEL}</button></td></tr>)}</tbody>
    </table></div>
    {loadError?<p className="v2-aviso erro" role="alert">{loadError}</p>:null}
    {next!==null?<button type="button" className="adm-btn sm" disabled={busy} onClick={more}>Carregar mais</button>:null}
    <dialog ref={dialog} className="adm-modal" aria-labelledby="mail-recovery-title" aria-describedby="mail-recovery-notice" onCancel={event=>{if(singleFlight.current)event.preventDefault();else close();}}>
      <div className="in"><h3 id="mail-recovery-title">{LABEL}</h3><p id="mail-recovery-notice">{NOTICE}</p>
        {target?<p><strong>#{target.queueId}</strong> · {target.toAddr}</p>:null}
        {error?<p className="v2-aviso erro" role="alert">{error}</p>:null}
        <div className="fim"><button type="button" className="adm-btn" autoFocus disabled={busy} onClick={close}>Cancelar</button><button type="button" className="adm-btn pri" disabled={busy} onClick={confirm}>{LABEL}</button></div>
      </div>
    </dialog>
  </section>;
}
