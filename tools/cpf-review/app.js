"use strict";
const state={view:"pending",group:"",q:"",status:"",name_decision:"",page:1};let result=null,timer,listRequest=0,busyDecisions=0,refreshKey="",pointerInTable=false;
const $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const fmt=n=>Number(n||0).toLocaleString("pt-BR"),display=v=>v===null||v===undefined||v===""?"Não disponível":String(v);
const date=v=>{if(!v)return"—";const d=new Date(v);return isNaN(d)?String(v):new Intl.DateTimeFormat("pt-BR",{timeZone:"America/Sao_Paulo",dateStyle:"short",timeStyle:"medium"}).format(d);};
async function api(path,body){const r=await fetch(path,body?{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(body)}:{});const j=await r.json();if(!r.ok)throw new Error(j.error||"Falha na operação local");return j;}
function message(s,error=false){$("message").textContent=s;$("message").className=error?"error":"";}
async function summary(){const s=await api("/api/stats");updateSync(s);$("metrics").replaceChildren();for(const [value,label] of [[Object.values(s.decisions).reduce((a,b)=>a+b,0),"Cadastros na base local"],[s.decisions.pending,"A decidir"],[s.decisions.approved,"Aprovados"],[s.decisions.rejected,"Rejeitados preservados"]]){const box=el("div",undefined,"metric");box.append(el("b",fmt(value)),el("span",label));$("metrics").append(box);}$("source").textContent="Dados sincronizados: "+date(s.source_at)+" · Brasília";$("groups").replaceChildren();for(const g of s.groups){const b=el("button",undefined,"group"+(state.group===g.classification?" active":""));b.dataset.group=g.classification;b.append(el("span",s.labels[g.classification]||g.classification),el("small",fmt(g.n)));$("groups").append(b);}return s;}
function td(value,cls){return el("td",display(value),cls);}
function detail(row){$("detail-title").textContent=row.name;const body=$("detail-body");body.replaceChildren();const grid=el("div",undefined,"detail-grid");for(const [label,value] of [["Inscrição / ID",`${row.seq||"Pendente"} / ${row.id}`],["Nome informado",row.name],["Nome CPF-Brasil",row.nome_api],["CPF recuperado",row.cpf],["Nascimento retornado",row.nascimento_api],["Mãe retornada",row.mae_api],["Sexo retornado",row.sexo_api],["Nascimento digitado na validação antiga","Não armazenado pelo aplicativo"],["Mãe digitada na validação antiga","Não armazenada pelo aplicativo"],["E-mail",row.email],["Criado em — Brasília",date(row.created_at)],["Confirmado em — Brasília",date(row.confirmed_at)],["IP registrado",row.ip],["Método de identidade",row.identity_method],["Estado nome×CPF no aplicativo",row.cpf_name_check],["Origem da evidência API",row.api_cache_ativo?"Cache ativo":row.api_evidencia_historica?"Histórico preservado":"Sem retorno cadastral"],["Consulta posterior contraditória",row.api_consulta_contraditoria?"Sim — revisar este caso":"Não"],["Navegador registrado",row.user_agent],["Retorno consultado em",date(row.consulta_em)],["Diferenças",row.comparison?.diferencas_nome]]){const p=el("p");p.append(el("strong",label),el("span",display(value)));grid.append(p);}body.append(grid,el("h3","Histórico de decisões"));api("/api/history?id="+row.id).then(items=>{if(!items.length)body.append(el("p","Nenhuma decisão manual registrada."));for(const item of items){const labels={approved:"Aprovado",rejected:"Rejeitado",pending:"A decidir"};body.append(el("div",`${date(item.at)} · ${item.reviewer}: ${labels[item.previous]||item.previous||"—"} → ${labels[item.current]||item.current}${item.note?" · "+item.note:""}`,"history"));}}).catch(e=>body.append(el("p",e.message)));$("detail").showModal();}
async function decide(row,value,controls){busyDecisions++;controls.forEach(n=>n.disabled=true);try{await api("/api/decision",{id:row.id,decision:value,revision:row.revision});await load();await summary();message(value==="rejected"?"Rejeitado na revisão local. O registro e seu histórico foram preservados.":"Aprovado na revisão local. Decisão salva no SQLite.");}catch(e){message(e.message,true);await load();}finally{busyDecisions--;}}
function render(rows){$("rows").replaceChildren();if(!rows.length){const tr=el("tr"),cell=el("td","Nenhum cadastro nesta seleção.","empty");cell.colSpan=16;tr.append(cell);$("rows").append(tr);return;}for(const row of rows){const tr=el("tr"),id=td(row.seq?"Nº "+row.seq:"Sem inscrição");id.append(el("small","ID "+row.id));tr.append(id);const category=el("td"),badge=el("span",row.classification_label,"badge"+(/forte|relevante/.test(row.classification)?" severe":/coincidencia|particulas/.test(row.classification)?" valid":""));if(row.api_consulta_contraditoria)category.append(el("strong","Retorno posterior contraditório — conferir", "error"));category.append(badge,el("div",row.comparison?.diferencas_nome||"Aguardando retorno cadastral associado."));if(row.comparison?.palavras_ausentes_no_informado)category.append(el("small","Ausentes: "+row.comparison.palavras_ausentes_no_informado));if(row.comparison?.palavras_extras_no_informado)category.append(el("small","Extras: "+row.comparison.palavras_extras_no_informado));tr.append(category,td(row.name),td(row.nome_api),nameCell(row));const cpf=row.cpf?row.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/,"$1.$2.$3-$4"):"Número não disponível";tr.append(td(cpf,"mono"),td(row.nascimento_api,"mono"),td(row.mae_api),td(row.sexo_api));const status=td(({servidor:"Servidor",apoiador:"Apoiador",estrangeiro:"Exterior"})[row.category]||row.category);status.append(el("small",row.status==="confirmed"?"Assinatura confirmada":"Assinatura pendente"));tr.append(status);const institution=td(row.institution||row.university);institution.append(el("small",row.campus||""),el("small",row.role||""));tr.append(institution,td([row.city,row.uf].filter(Boolean).join(" / ")||row.country),td(row.region_declared===null?"—":row.region_declared?"Sim":"Não"),td(row.email));const dates=td(date(row.created_at));dates.append(el("small","Confirmação: "+date(row.confirmed_at)));const more=el("button","Detalhes e histórico","text-button");more.onclick=()=>detail(row);dates.append(more);tr.append(dates);const decision=el("td"),controls=[];for(const [value,label,cls] of [["approved","Aprovar","approve"],["rejected","Rejeitar","reject"]]){const l=el("label",undefined,"radio "+cls),radio=el("input");radio.type="radio";radio.name="decision-"+row.id;radio.value=value;radio.checked=row.decision===value;radio.setAttribute("aria-label",label+" "+row.name);controls.push(radio);radio.onchange=()=>decide(row,value,controls);l.append(radio,document.createTextNode(label));decision.append(l);}if(row.decision!=="pending"){const undo=el("button","Voltar para revisão","text-button");undo.onclick=()=>decide(row,"pending",controls);decision.append(undo);}tr.append(decision);$("rows").append(tr);}}
async function load(){if(nameDirty){message("Há alterações de nome não salvas. Salve ou feche o editor antes de atualizar a lista.");return;}updateBulkScope();const request=++listRequest;try{message("Carregando base local…");const p=new URLSearchParams(state);const received=await api("/api/records?"+p);if(request!==listRequest)return;result=received;state.page=result.page;render(result.rows);$("count").textContent=fmt(result.total)+" registros";const pages=Math.max(1,Math.ceil(result.total/result.limit));$("page").textContent=`Página ${result.page} de ${pages}`;$("prev").disabled=state.page<=1;$("next").disabled=state.page>=pages;message("Horários de registro e confirmação exibidos em Brasília.");}catch(e){if(request===listRequest)message(e.message,true);}}
function selectCpfView(view){state.view=view;state.page=1;$("cpf-decision").value=view;document.querySelectorAll("[data-view]").forEach(n=>n.classList.toggle("selected",n.dataset.view===view));$("title").textContent=({pending:"Cadastros a decidir",active:"Lista ativa",approved:"Aprovados na revisão",rejected:"Rejeitados — preservados",all:"Todos os cadastros",not_approved:"CPFs ainda não aprovados"})[view];load();}
$("views").onclick=e=>{const b=e.target.closest("[data-view]");if(b)selectCpfView(b.dataset.view);};
$("cpf-decision").onchange=()=>selectCpfView($("cpf-decision").value);
$("name-decision").onchange=()=>{state.name_decision=$("name-decision").value;state.page=1;load();};
document.querySelector("aside").onclick=e=>{const b=e.target.closest("[data-group]");if(!b)return;state.group=b.dataset.group;state.page=1;document.querySelectorAll("[data-group]").forEach(n=>n.classList.toggle("active",n===b));load();};
$("search").oninput=()=>{clearTimeout(timer);timer=setTimeout(()=>{state.q=$("search").value;state.page=1;load();},250);};$("status").onchange=()=>{state.status=$("status").value;state.page=1;load();};$("prev").onclick=()=>{state.page--;load();};$("next").onclick=()=>{state.page++;load();};$("reload").onclick=async()=>{try{$("reload").disabled=true;message("Baixando dados da VPS e conferindo a integridade…");await api("/api/sync",{});await summary();await load();}catch(e){message(e.message,true);}finally{$("reload").disabled=false;}};
function updateSync(s){const status=$("sync-status"),x=s.sync||{};const success=x.last_success_at?new Date(x.last_success_at).getTime():0;const stale=!success||Date.now()-success>90000;status.textContent="VPS → SQLite · somente leitura · "+(x.state==="offline"||stale?"sem conexão recente; cópia local preservada":"recepção automática a cada "+(x.interval_seconds||30)+" s")+(x.last_checked_at?" · conferido "+date(x.last_checked_at):"");status.className=x.state==="offline"||stale?"sync-stale":"";status.title="Versão da validação na VPS: "+(s.validation_version||"não informada")+". Recebido: "+date(s.received_at);}
async function autoRefresh(){if(document.hidden)return;try{const s=await api("/api/stats");updateSync(s);const key=JSON.stringify([s.source_at,s.decisions,s.review_version,s.name_decisions,s.name_revision,s.names_updated_at]);if(refreshKey&&refreshKey!==key){const table=document.querySelector(".table-wrap");if(busyDecisions||nameDirty||$("name-editor").open||$("bulk-confirm").open||$("detail").open||pointerInTable||table.contains(document.activeElement)||window.getSelection()?.toString()){$("sync-status").textContent+=" · atualização da tabela aguardando uma pausa";return;}await summary();await load();message("Dados atualizados automaticamente. Filtros e decisões preservados.");}refreshKey=key;}catch{$("sync-status").textContent="Cópia local disponível; aguardando conexão com o serviço local.";}}
summary().then(s=>{refreshKey=JSON.stringify([s.source_at,s.decisions,s.review_version,s.name_decisions,s.name_revision,s.names_updated_at]);return load();}).catch(e=>message(e.message,true));
setInterval(autoRefresh,5000);

const tableArea=document.querySelector(".table-wrap");tableArea.addEventListener("pointerenter",()=>{pointerInTable=true;});tableArea.addEventListener("pointerleave",()=>{pointerInTable=false;});

let nameDirty=false,nameEditing=null,nameRequest=0,nameSaving=false,bulkPreview=null,lastBatch=null;
const nameLabels={pending:"Nome a decidir",approved:"Nome aprovado",rejected:"Sugestão recusada"};
function nameCell(row){
  const cell=el("td",undefined,"name-cell"),text=el("strong","Carregando sugestão…"),status=el("small"),approve=el("button","Aprovar nome","name-approve"),button=el("button","Revisar nome para impressão","text-button"),feedback=el("small",undefined,"name-inline-feedback");
  let shown=null,saving=false;
  approve.type="button";approve.disabled=true;button.onclick=()=>openName(row);cell.append(text,status,approve,button,feedback);
  const show=n=>{if(!cell.isConnected)return;shown=n;row.names=n;text.textContent=(!n.stale&&!n.policy_review_required&&(n.decision==="approved"||n.previous_policy_version===n.policy_version)?n.selected_name:null)||n.proposed||"Sem sugestão disponível";status.textContent=(nameLabels[n.decision]||"Nome a decidir")+(n.special?" · caso especial":"");status.className=n.decision==="approved"?"name-approved":"";approve.textContent=n.decision==="approved"?"✓ Nome aprovado":"Aprovar nome";approve.disabled=saving||n.decision==="approved"||!(n.selected_name||n.proposed);approve.setAttribute("aria-label","Aprovar nome exibido: "+text.textContent);};
  approve.onclick=async()=>{
    if(!shown||saving)return;
    if(shown.instruction){feedback.textContent="Há uma instrução pendente. Confira-a em Revisar nome para impressão antes de aprovar.";feedback.className="name-inline-feedback error";return;}
    const n=shown,literal=text.textContent;saving=true;approve.disabled=true;button.disabled=true;approve.textContent="Salvando…";feedback.textContent="";busyDecisions++;
    try{
      const saved=await api("/api/name-decision",{id:row.id,revision:n.revision||row.revision,name_revision:n.name_revision,version:n.version,decision:"approved",choice:"custom",literal,instruction:"",policy_version:n.policy_version});
      saving=false;show({...n,...saved,decision:"approved",selected_name:literal,choice:"custom",version:saved.version??n.version+1});feedback.className="name-inline-feedback";feedback.textContent="Nome aprovado. Decisão do CPF preservada.";
    }catch(e){saving=false;show(n);feedback.className="name-inline-feedback error";feedback.textContent=e.message;}
    finally{busyDecisions--;button.disabled=false;}
  };
  if(row.names)queueMicrotask(()=>show(row.names));else api("/api/names?id="+row.id).then(show).catch(()=>{if(cell.isConnected)text.textContent="Abra para conferir a sugestão";});
  return cell;
}
function nameOption(value,label,text,checked){
  const wrap=el("label",undefined,"name-option"),radio=el("input");radio.type="radio";radio.name="print-name-choice";radio.value=value;radio.checked=checked;
  const description=el("span");description.append(el("strong",label),el("span",display(text)));wrap.append(radio,description);return wrap;
}
async function openName(row){
  if(nameSaving){message("Aguarde a gravação do nome em andamento.");return;}
  if(nameDirty&&!window.confirm("Descartar as alterações de nome ainda não salvas?"))return;
  nameDirty=false;$("name-form").querySelectorAll("button[data-name-action]").forEach(b=>b.disabled=false);const request=++nameRequest;nameEditing=null;$("name-record").textContent=`Inscrição ${row.seq||"pendente"} · ID ${row.id}`;$("name-comparison").replaceChildren();$("name-options").replaceChildren();$("name-reasons").textContent="Carregando…";$("name-feedback").textContent="";$("name-history").replaceChildren();$("name-form").hidden=true;$("name-ai-proposal").hidden=true;$("name-variants").replaceChildren();$("name-stale").hidden=true;
  if(!$("name-editor").open)$("name-editor").showModal();
  try{
    const n=await api("/api/names?id="+row.id);if(request!==nameRequest||!$("name-editor").open)return;
    nameEditing={row,n};$("name-stale").hidden=!(n.stale||n.policy_review_required);const grid=$("name-comparison");
    for(const [label,value] of [["Original digitado — preservado",row.name],["Original da API — preservado",row.nome_api],["Digitado com sugestão de acentos",n.entered_resolved],["API com sugestão de acentos",n.api_resolved]]){const p=el("p");p.append(el("strong",label),el("span",display(value)));grid.append(p);}
    $("name-reasons").textContent=(Array.isArray(n.reasons)?n.reasons.join(" · "):n.reasons||"")+" · Dicionário da sugestão atual: "+display(n.dictionary_version)+(n.approved_dictionary_version?" · Versão registrada na decisão: "+n.approved_dictionary_version:"");$("name-special").hidden=!n.special;
    const chosen=n.stale||n.policy_review_required||n.decision!=="approved"&&n.previous_policy_version!==n.policy_version?"proposed":n.choice||"proposed",options=$("name-options");
    for(const [value,label,text] of [["proposed","Sugestão principal",n.proposed],["entered","Nome digitado com acentos sugeridos",n.entered_resolved],["api","Nome da API com acentos sugeridos",n.api_resolved]])if(text)options.append(nameOption(value,label,text,chosen===value));
    options.append(nameOption("custom","Outra forma literal","Use o campo abaixo para definir o texto exato.",chosen==="custom"));
    if(!options.querySelector("input:checked"))options.querySelector("input").checked=true;
    const variants=n.variant_options||[];
    if(variants.length){$("name-variants").append(el("h3","Grafias documentadas alternativas — conferir individualmente"));const list=el("ul");for(const variant of variants){const input=Array.isArray(variant)?variant[0]:variant.input,values=Array.isArray(variant)?variant[1]:variant.variants;list.append(el("li",display(input)+": "+(Array.isArray(values)?values.join(" / "):display(values))));}$("name-variants").append(list);}
    const ai=n.ai_proposal;$("name-ai-proposal").hidden=!ai;
    if(ai){$("name-ai-literal").textContent=display(ai.literal);$("name-ai-explanation").textContent=display(ai.explanation);$("name-ai-uncertainty").textContent="Incerteza: "+display(ai.uncertainty);$("name-ai-use").disabled=!ai.literal;}
    $("name-literal").value=n.literal||(chosen==="custom"?n.selected_name||"":"");$("name-instruction").value=n.instruction||"";$("name-form").hidden=false;
    const history=n.history||[];if(history.length){$("name-history").append(el("h3","Histórico do nome para impressão"));for(const item of history)$("name-history").append(el("p",`${date(item.at)} · ${item.reviewer||"revisão local"} · ${item.decision||item.current||""}${item.selected_name?" · "+item.selected_name:""}`,"history"));}
    nameDirty=false;
  }catch(e){$("name-feedback").textContent=e.message;$("name-feedback").className="error";}
}
$("name-form").addEventListener("input",()=>{nameDirty=true;$("name-feedback").textContent="Alterações ainda não salvas.";});
$("name-literal").addEventListener("input",()=>{const custom=$("name-options").querySelector('[value="custom"]');if(custom)custom.checked=true;});
$("name-editor").addEventListener("cancel",event=>{if(nameDirty&&!window.confirm("Descartar as alterações de nome ainda não salvas?"))event.preventDefault();});
$("name-editor").querySelector("form[method=dialog]").addEventListener("submit",event=>{if(nameDirty&&!window.confirm("Descartar as alterações de nome ainda não salvas?"))event.preventDefault();});
$("name-editor").addEventListener("close",()=>{nameDirty=false;nameEditing=null;nameRequest++;});
window.addEventListener("beforeunload",event=>{if(nameDirty){event.preventDefault();event.returnValue="";}});
$("name-form").addEventListener("submit",async event=>{
  event.preventDefault();if(!nameEditing||nameSaving)return;const decision=event.submitter?.dataset.nameAction||"pending",choice=$("name-options").querySelector("input:checked")?.value||"proposed",literal=$("name-literal").value.trim(),instruction=$("name-instruction").value.trim();
  if(decision==="approved"&&choice==="custom"&&!literal){$("name-feedback").textContent="Escreva o nome literal para aprovar essa opção.";$("name-literal").focus();return;}
  const {row,n}=nameEditing;const saveRequest=nameRequest;nameSaving=true;let saved=false;const buttons=[...$("name-form").querySelectorAll("button")];buttons.forEach(b=>b.disabled=true);busyDecisions++;
  try{
    await api("/api/name-decision",{id:row.id,revision:n.revision||row.revision,name_revision:n.name_revision,version:n.version,policy_version:n.policy_version,decision,choice,literal,instruction});
    saved=true;if(saveRequest===nameRequest){nameDirty=false;$("name-editor").close();}message(decision==="approved"?"Nome para impressão aprovado. A decisão do CPF foi preservada.":decision==="rejected"?"Sugestão de nome recusada; aguardando nova escolha. A decisão do CPF foi preservada.":"Nome e instrução salvos para revisão. Nenhuma aprovação automática foi feita.");
  }catch(e){if(saveRequest===nameRequest){$("name-feedback").textContent=e.message;$("name-feedback").className="error";}else message(e.message,true);}finally{nameSaving=false;busyDecisions--;buttons.forEach(b=>b.disabled=false);}
  if(saved){await summary();await load();}
});
function updateBulkScope(){
  const selected=Boolean(state.group);document.querySelectorAll("[data-bulk-kind]").forEach(b=>b.disabled=!selected||Boolean(bulkPreview));
  $("bulk-scope").textContent=selected?"Categoria selecionada · filtros atuais · todas as páginas · somente pendentes":"Selecione uma categoria para decisões em lote.";
}
document.querySelector(".bulk-actions").addEventListener("click",async event=>{
  const b=event.target.closest("[data-bulk-kind]");if(!b||!state.group)return;
  if(nameDirty){message("Salve o nome em edição antes de preparar um lote.",true);return;}
  b.disabled=true;busyDecisions++;
  try{
    const p=await api("/api/bulk-preview",{kind:b.dataset.bulkKind,decision:b.dataset.bulkDecision,filters:{...state}});bulkPreview=p;
    $("bulk-title").textContent=(b.dataset.bulkDecision==="approved"?"Aprovar":"Rejeitar")+(b.dataset.bulkKind==="cpf"?" CPFs":" sugestões de nomes");
    $("bulk-description").textContent=`${fmt(p.count)} registros no lote · ${fmt(p.skipped)} ignorados. ${b.dataset.bulkKind==="name"?"Casos especiais ficam para decisão individual.":"O lote não decide os nomes para impressão."}`;
    $("bulk-feedback").textContent="";$("bulk-confirm-apply").disabled=!p.count;$("bulk-confirm").showModal();
  }catch(e){message(e.message,true);}finally{busyDecisions--;updateBulkScope();}
});
$("bulk-cancel").onclick=()=>$("bulk-confirm").close();
$("bulk-confirm").addEventListener("close",()=>{bulkPreview=null;updateBulkScope();});
$("bulk-confirm-apply").onclick=async()=>{
  if(!bulkPreview)return;const token=bulkPreview.token;$("bulk-confirm-apply").disabled=true;busyDecisions++;
  try{const response=await api("/api/bulk-apply",{token});lastBatch=response.batch_id||null;$("bulk-undo").hidden=!lastBatch;$("bulk-confirm").close();await summary();await load();message("Lote salvo com histórico. As decisões anteriores foram preservadas.");}
  catch(e){$("bulk-feedback").textContent=e.message;$("bulk-feedback").className="error";}
  finally{busyDecisions--;}
};
$("bulk-undo").onclick=async()=>{
  if(!lastBatch||!window.confirm("Desfazer as decisões do último lote? Decisões posteriores não devem ser sobrescritas."))return;
  $("bulk-undo").disabled=true;busyDecisions++;
  try{await api("/api/bulk-undo",{batch_id:lastBatch});lastBatch=null;$("bulk-undo").hidden=true;await summary();await load();message("Lote desfeito; o histórico foi preservado.");}catch(e){message(e.message,true);}finally{busyDecisions--;$("bulk-undo").disabled=false;}
};

$("generate-preview").onclick=async()=>{
  if(nameDirty){message("Salve o nome em edição antes de gerar a prévia.",true);return;}
  const button=$("generate-preview"),output=$("preview-result");button.disabled=true;busyDecisions++;output.textContent="Gerando prévia local a partir das decisões salvas…";
  try{const p=await api("/api/preview",{});output.textContent=`Prévia local: ${display(p.pdf)}\nPasta: ${display(p.directory)}\nRegistros incluídos: ${fmt(p.records)} · Excluídos desta prévia: ${fmt(p.excluded)}`;output.className="";}
  catch(e){output.textContent=e.message;output.className="error";}
  finally{button.disabled=false;busyDecisions--;}
};

$("name-ai-use").onclick=()=>{
  const proposal=nameEditing?.n.ai_proposal;if(!proposal?.literal)return;
  $("name-literal").value=proposal.literal;const custom=$("name-options").querySelector('[value="custom"]');if(custom)custom.checked=true;
  $("name-instruction").value="";nameDirty=true;$("name-feedback").textContent="Proposta interpretada selecionada. Confira o texto e aprove o nome para incluí-lo na prévia.";$("name-literal").focus();
};
