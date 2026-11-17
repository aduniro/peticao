"use client";
import { useEffect, useRef, useState } from "react";
import type { HistoryRow as MailHistoryRow } from "@/lib/mail-history-admin-contract";
import { readHistoryMetadata } from "@/lib/mail-history-admin-client";
import { brasilia } from "@/lib/time";
import HistoricoMensagem from "./HistoricoMensagem";

type Preview = { subject: string; html: string };
const LABEL = "Ver prévia protegida";
const NOTICE = "Esta prévia oculta links, imagens e códigos e simplifica a formatação. O e-mail original foi preservado.";

type Props={initial:MailHistoryRow[];next:string|null;names:Record<string,string>;canPreview?:boolean;actorScope:string;initialAsOf:string;initialTotal:number};
export default function PreviaEmail(props:Props){return <PreviewContext key={JSON.stringify([props.actorScope,props.canPreview??false,props.initialAsOf,props.initialTotal,props.next])} {...props}/>;}
function PreviewContext({initial,next:firstNext,names,canPreview=false,actorScope,initialAsOf,initialTotal}:Props){
  const dialog = useRef<HTMLDialogElement>(null), controller = useRef<AbortController | null>(null);
  const [rows, setRows] = useState(initial), [next, setNext] = useState(firstNext);
  const [total,setTotal]=useState(initialTotal),[asOf,setAsOf]=useState(initialAsOf);
  const [preview, setPreview] = useState<Preview | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const snapshot=useRef({initial,firstNext,initialAsOf,initialTotal});
  useEffect(() => () => { controller.current?.abort(); controller.current=null; }, []);
  useEffect(() => {
    const previous=snapshot.current;if(previous.initial===initial&&previous.firstNext===firstNext&&previous.initialAsOf===initialAsOf&&previous.initialTotal===initialTotal)return;
    snapshot.current={initial,firstNext,initialAsOf,initialTotal};controller.current?.abort();controller.current=null;dialog.current?.close();setPreview(null);setError(null);setListError(null);setBusy(false);setRows(initial);setNext(firstNext);setTotal(initialTotal);setAsOf(initialAsOf);
  }, [initial,firstNext,initialAsOf,initialTotal]);
  const clearProtected=(message:string)=>{controller.current?.abort();controller.current=null;dialog.current?.close();setPreview(null);setError(null);setRows([]);setNext(null);setBusy(false);setListError(message);};
  const auth = (response: Response, data: any) => {
    if (response.status === 401) { clearProtected("Sua sessão não permite consultar este histórico."); window.location.assign("/admin"); return true; }
    if (response.status === 403 && data?.erro === "stepup") { clearProtected("Confirme novamente seu acesso para consultar a prévia protegida."); window.location.assign("/admin/confirmar?volta=%2Fadmin%2Femails"); return true; }
    if(response.status===403){clearProtected("Sua sessão não permite consultar este histórico.");return true;}
    return false;
  };
  const close = () => { controller.current?.abort(); controller.current = null; dialog.current?.close(); setPreview(null); setError(null); setBusy(false); };
  const open = async (id: string) => {
    if (controller.current) return;
    const active = new AbortController(); controller.current = active; setBusy(true); setError(null); setPreview(null); dialog.current?.showModal();
    const timer = setTimeout(() => active.abort(), 15_000);
    try {
      const response = await fetch(`/api/admin/emails/mensagens/previa?id=${encodeURIComponent(id)}`, { credentials: "same-origin", cache: "no-store", signal: active.signal });
      const data = await response.json();
      if (controller.current !== active || auth(response, data)) return;
      if (!response.ok || data?.ok !== true) throw new Error("preview_unavailable");
      if (data.state !== "ready") { setError("Prévia indisponível para esta mensagem."); return; }
      if (data.transformed !== true || typeof data.html !== "string" || data.html.length > 1_000_000 || typeof data.subject !== "string") throw new Error("invalid_preview");
      setPreview({ html: data.html, subject: data.subject });
    } catch { if (controller.current === active) setError("Não foi possível carregar a prévia. Tente novamente."); }
    finally { clearTimeout(timer); if (controller.current === active) { controller.current = null; setBusy(false); } }
  };
  const more=async()=>{
    if(!next||controller.current)return;const before=next,active=new AbortController();controller.current=active;setBusy(true);setListError(null);
    try{const result=await readHistoryMetadata(new URLSearchParams({limit:"10",before}),active.signal);if(controller.current!==active)return;
      if(!result.ok){if(result.kind==="aborted")return;if(result.kind==="http"&&(result.status===401||result.status===403)){clearProtected("Sua sessão não permite consultar este histórico.");if(result.status===401)window.location.assign("/admin");return;}if(result.kind==="invalid"){clearProtected("A resposta da lista não pôde ser validada. Atualize a página para consultar novamente.");return;}setListError("Não foi possível carregar a lista. Tente novamente.");return;}
      if(result.mode!=="list"){clearProtected("A resposta da lista não pôde ser validada.");return;}
      setRows(old=>{const seen=new Set(old.map(row=>row.record_key));return[...old,...result.data.records.filter(row=>{if(seen.has(row.record_key))return false;seen.add(row.record_key);return true;})];});setNext(result.data.next);setTotal(result.data.total);setAsOf(result.data.asOf);
    }catch{if(controller.current===active)setListError("Não foi possível carregar a lista. Tente novamente.");}
    finally{if(controller.current===active){controller.current=null;setBusy(false);}}
  };
  if (!rows.length && !next && !listError) return null;
  return <section data-testid="mail-preview-history" aria-busy={busy}>
    <h3>Histórico de mensagens</h3>
    {/* MUDAR AQUI: as páginas não representam uma única revisão congelada do histórico. */}
    {rows.length?<p className="small">{rows.length} registro(s) carregado(s) · total da última consulta: {total} · {brasilia(asOf,true)}. Cada continuação reflete sua própria consulta.</p>:null}
    <div className="table-scroll"><table style={{ minWidth: 720 }}><thead><tr><th>ID</th><th>Tipo</th><th>E-mail</th><th>Histórico</th><th>{LABEL}</th></tr></thead>
      <tbody>{rows.map(row => <tr key={row.record_key}><td>{row.record_key}</td><td>{names[row.kind] ?? row.kind}</td><td>{row.to_addr}</td><td><HistoricoMensagem recordKey={row.record_key} actorScope={`${actorScope}:${initialAsOf}`} onUnauthorized={()=>clearProtected("Sua sessão não permite consultar este histórico.")} /></td><td>{canPreview && row.record_key.startsWith("message:") && row.content_state === "stored" ? <button type="button" className="adm-btn sm" disabled={busy} onClick={() => open(row.record_key.slice(8))}>{LABEL}</button> : "[restrito]"}</td></tr>)}</tbody>
    </table></div>
    {listError ? <p className="v2-aviso erro" role="alert">{listError}</p> : null}
    {next ? <button type="button" className="adm-btn sm" disabled={busy} onClick={more}>Carregar mais</button> : null}
    <dialog ref={dialog} className="adm-modal" aria-labelledby="mail-preview-title" onCancel={close}>
      <div className="in"><div className="adm-bar"><h3 id="mail-preview-title">{LABEL}</h3><button type="button" className="adm-btn" onClick={close}>Fechar</button></div><p>{NOTICE}</p>
        {error ? <p className="v2-aviso erro" role="alert">{error}</p> : null}
        {preview ? <><p>{preview.subject}</p><iframe title={LABEL} sandbox="" referrerPolicy="no-referrer" srcDoc={preview.html} style={{ width: "100%", height: "60vh", border: 0 }} /></> : null}
      </div>
    </dialog>
  </section>;
}
