import { renderLiveTree } from "./tree-render.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = dirname(fileURLToPath(import.meta.url));
export const OWNER = "operator-1608598f41@example.invalid";
const PERIOD = 60 * 60 * 1000;
const STATES = { running: "Em execução registrada", queued: "Na fila", waiting: "Aguardando", paused: "Pausada", completed: "Concluída", interrupted: "Interrompida", failed: "Falhou" };

export function safeText(value) {
  return String(value ?? "Não informado")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[e-mail omitido]")
    .replace(/(?<!\d)(?:\d{3}\.\d{3}\.\d{3}-\d{2}|\d{11})(?!\d)/g, "[identificador omitido]")
    .replace(/((?:token|password|senha|secret|authorization|api[_-]?key)\s*[:=]\s*)\S+/gi, "$1[omitido]")
    .slice(0, 2500);
}
const escape = (value) => safeText(value).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const percent = (n) => typeof n === "number" && Number.isFinite(n) ? `${n.toFixed(1).replace(".", ",")}%` : "Sem medição intermediária";
const duration = (seconds) => typeof seconds === "number" ? `${Math.floor(seconds / 3600)}h ${Math.floor(seconds % 3600 / 60)}min` : "Não registrado";
const time = (value) => {
  if (!value) return "Não registrado";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? safeText(value) : date.toLocaleString("pt-BR", { timeZone: "America/Porto_Velho", hour12: false }) + " (Porto Velho)";
};

export function renderReport(data) {
  const html = [], text = [];
  const title = (value, level = 2) => { html.push(`<h${level}>${escape(value)}</h${level}>`); text.push(`\n${safeText(value)}\n`); };
  const paragraph = (value) => { html.push(`<p>${escape(value)}</p>`); text.push(safeText(value) + "\n"); };
  const table = (headers, rows) => {
    html.push('<table border="1" cellpadding="6" cellspacing="0"><thead><tr>' + headers.map((v) => `<th>${escape(v)}</th>`).join("") + "</tr></thead><tbody>" + rows.map((r) => "<tr>" + r.map((v) => `<td>${escape(v)}</td>`).join("") + "</tr>").join("") + "</tbody></table>");
    text.push(headers.map(safeText).join(" | ") + "\n" + rows.map((r) => r.map(safeText).join(" | ")).join("\n") + "\n");
  };
  title("Relatório periódico de andamento — petição", 1);
  paragraph(`Gerado em ${time(data.generated_at)}. Cadência: uma hora enquanto o acompanhamento autorizado estiver habilitado. Percentuais calculados pelas etapas concluídas registradas no Vigia, com os pesos existentes; não são medição de CPU nem garantia de execução contínua de agentes.`);
  paragraph("Ambiente deste relatório: monitor e candidato locais. A rotina não inicia agentes, não altera a aplicação, não executa deploy e não consulta a VPS. Estados são registros do Vigia; registros sem atualização há mais de dez minutos são sinalizados.");
  title("Árvore completa do painel admin-v2");
  const tree = data.tree;
  let treeSvg;
  const csvRows = [["Nível", "ID", "Parte", "Percentual dos marcos", "Estado registrado no Vigia", "Pendência", "Evidências", "Fonte/commit", "Data da captura"]];
  if (!tree?.available) paragraph(tree?.reason ?? "Snapshot da árvore indisponível; nenhum percentual foi estimado.");
  else if (tree.source === "vigia_sqlite_read_only") {
    const graphical = renderLiveTree(tree, { escape, percent }); html.push(graphical.html); treeSvg = graphical.svg;
    paragraph(`Marcos atuais: ${percent(tree.percent)}. Captura SQLite somente leitura de ${time(tree.snapshot_at)}. Fonte: ${tree.path}.`);
    paragraph(tree.method); paragraph(tree.state_policy);
    paragraph(`Registro da tarefa no Vigia: ${time(tree.recorded_at)}${tree.recorded_stale ? " — SEM ATUALIZAÇÃO RECENTE" : ""}.`);
    const add = (level, item) => { csvRows.push([level,item.id,item.title,item.percent.toFixed(4),item.state,item.note??"",(item.evidence??[]).join(" | "),"Vigia atual",tree.snapshot_at]); text.push(`${level} ${item.id} ${safeText(item.title)} — ${percent(item.percent)} [${safeText(item.state)}]${item.note && item.note !== "Calculado dos marcos e pesos atuais do Vigia." ? " · " + safeText(item.note) : ""}${item.evidence?.length ? " · Evidências: " + item.evidence.map(safeText).join(" | ") : ""}`); };
    for(const section of tree.sections){add("Seção",section);for(const module of section.modules){add("Módulo",module);for(const f of module.functions)add("Funcionalidade",f);}}
  }
  else {
    paragraph(`Marcos: ${percent(tree.percent)}. Snapshot de ${time(tree.snapshot_at)}, commit ${tree.commit}. Arquivo: ${tree.path}.`);
    paragraph(`HEAD observado agora: ${data.git?.head ?? "indisponível"}. Alterações posteriores ao snapshot não herdam sua comprovação. ${tree.state_policy}`);
    paragraph(`Registro da árvore no Vigia: ${time(tree.recorded_at)}${tree.recorded_stale ? " — SEM ATUALIZAÇÃO RECENTE" : ""}.`);
    paragraph(tree.method);
    const row = (level, item) => csvRows.push([level, item.id, item.title, item.percent.toFixed(4), item.state, item.note ?? "", (item.evidence ?? []).join(" | "), tree.commit, tree.snapshot_at]);
    for (const section of tree.sections) {
      title(`${section.id}. ${section.title} — ${percent(section.percent)} [${section.state}]`, 3); row("Seção", section);
      for (const module of section.modules) {
        paragraph(`${module.id} ${module.title} — ${percent(module.percent)} [${module.state}]`); row("Módulo", module);
        table(["Funcionalidade", "Marcos do snapshot", "Estado registrado", "Pendência"], module.functions.map((f) => { row("Funcionalidade", f); return [`${f.id} ${f.title}`, percent(f.percent), f.state, f.note]; }));
      }
    }
  }
  title("Coordenação das duas sessões");
  const coordination = data.coordination;
  if (!coordination?.available) paragraph("Histórico comum indisponível nesta captura; nenhum estado de execução foi presumido.");
  else {
    paragraph("Histórico comum: /mnt/apps/peticao-final/_ops/coordenacao-dupla/. Um único relatório horário cobre ambas as sessões. Atividade recente em metadados não comprova processo em execução; o horário do coletor não é progresso.");
    if (coordination.sessions?.length) table(["Coordenador", "Sessão", "Observação", "Última atividade da conversa", "Última ferramenta", "Estado do turno"], coordination.sessions.map(s => [s.actor,s.thread_id,s.observation_state+(s.stale?" — SEM ATIVIDADE RECENTE":""),time(s.last_activity_at),s.last_tool_name,s.turn_state]));
    else paragraph("Metadados das conversas ainda sem captura; consultar os checkpoints registrados abaixo.");
    table(["Participante", "Checkouts registrados"], (coordination.actors??[]).map(a => [a.id,(a.repos??[]).join(" | ")]));
    if (coordination.events?.length) table(["Quando", "Sessão", "Evento", "O que foi registrado"],coordination.events.map(e => [time(e.at),e.actor,e.kind,e.summary]));
    if (coordination.leases?.length) table(["Responsável", "Operação", "Estado", "Recursos", "Validade"],coordination.leases.map(l => [l.actor,l.operation,l.state,l.resources,time(new Date(l.expires*1000).toISOString())]));
    if (coordination.pending_ack?.length) table(["Evento", "Autor", "ACK pendente", "Assunto"],coordination.pending_ack.map(a => [a.seq,a.actor,a.missing_actor,a.summary]));
    paragraph("Os subagentes aparecem nas tarefas e subetapas do Vigia abaixo quando possuem registro verificável. Nenhum novo agente é iniciado por este relatório. Publicação da página exige pedido acompanhado de deploy, manifesto, ACK e trava; deploy do admin-v2 exige autorização específica.");
  }
  title("Frentes principais");
  for (const task of data.primary_tasks ?? []) {
    title(task.title, 3);
    table(["Estado", "Etapa registrada", "Progresso", "Desde criação", "Estimativa registrada", "Última atualização"], [[STATES[task.state] ?? task.state, task.stage, percent(task.progress), duration(task.seconds_since_creation), task.eta, time(task.updated_at) + (task.stale ? " — SEM ATUALIZAÇÃO RECENTE" : "")]]);
    paragraph(`Escopo registrado: ${task.scope}. Ambiente: ${task.environment}. Diretório: ${task.cwd}.`);
    if (task.steps?.length) table(["Etapa/subetapa", "Estado", "Progresso registrado", "Desde início", "Estimativa", "Atualização"], task.steps.map((step) => [step.parent ? `${step.parent} / ${step.title}` : step.title, STATES[step.state] ?? step.state, percent(step.progress), duration(step.seconds_since_start), step.eta, time(step.updated_at)]));
  }
  title("Outras tarefas com execução ou fila registradas");
  if (data.other_running?.length) table(["Tarefa", "Estado", "Etapa", "Progresso", "Atualização"], data.other_running.map((task) => [task.title, STATES[task.state] ?? task.state, task.stage, percent(task.progress), time(task.updated_at) + (task.stale ? " — sem atualização recente" : "")]));
  else paragraph("Nenhuma outra tarefa com execução ou fila registrada.");
  title("Pausadas, aguardando ou interrompidas — separadas da execução");
  if (data.paused_waiting?.length) table(["Tarefa", "Estado", "Etapa", "Estimativa", "Atualização"], data.paused_waiting.map((task) => [task.title, STATES[task.state] ?? task.state, task.stage, task.eta, time(task.updated_at)]));
  else paragraph("Nenhuma outra tarefa nessas condições.");
  title("Git observado no candidato local");
  if (data.git?.unavailable) paragraph("Não foi possível consultar o Git neste ciclo; nenhuma alteração foi feita para contornar a indisponibilidade.");
  else table(["Diretório", "Branch", "Commit", "Assunto", "Caminhos da aplicação modificados"], [[data.git?.path, data.git?.branch, data.git?.head, data.git?.subject, data.git?.modified_app_paths]]);
  title("QA — evidências separadas por execução congelada");
  paragraph("Um teste aprovado em uma captura antiga não comprova uma revisão posterior. Referência da fonte e arquivos de saída são apresentados por execução; ausência de resultado permanece sem registro. Código de saída zero indica sucesso daquele comando, não aprovação automática de toda a plataforma.");
  for (const qa of data.qa ?? []) {
    title(qa.path, 3);
    paragraph(`Referência congelada: ${qa.source_reference ?? "Não registrada"}.`);
    const rows = Object.entries(qa.checks ?? {}).map(([name, result]) => [name, result.unreadable ? "Resultado ilegível" : result.exit_code === 0 ? "Comando concluído com sucesso" : `Falha: código ${result.exit_code}`, time(result.recorded_at)]);
    if (rows.length) table(["Verificação", "Resultado registrado", "Data do arquivo de saída"], rows);
    else paragraph("Nenhum arquivo final de resultado registrado; verificar se a execução está em andamento.");
    if (qa.browser_cases_recorded !== undefined) paragraph(`Navegador: ${qa.browser_cases_recorded} cenários registrados; ${qa.browser_errors_recorded} entradas de erro. Conteúdo e logs individuais não são anexados.`);
  }
  title("Normalização de instituições — somente totais");
  for (const item of data.normalization ?? []) {
    title(item.source, 3);
    paragraph(`Captura: ${time(item.snapshot_at)}. Alterações aplicadas segundo o plano: ${item.changes_applied ? "Sim" : "Não"}.`);
    const rows = [];
    const flatten = (object, prefix = "") => {
      for (const [key, value] of Object.entries(object ?? {})) {
        if (typeof value === "number" || typeof value === "boolean") rows.push([prefix + key, value]);
        else if (value && typeof value === "object" && !Array.isArray(value)) flatten(value, prefix + key + " / ");
      }
    };
    flatten(item.counts);
    if (rows.length) table(["Indicador", "Quantidade/condição registrada"], rows);
  }
  title("Limites e proteção dos dados");
  paragraph(data.source_policy ?? "Somente metadados operacionais e contagens. Nenhuma linha de cadastro, CPF, endereço de signatário, segredo ou log bruto é anexado.");
  paragraph("O aceite do provedor de e-mail não comprova entrega ou leitura. O acompanhamento horário permanece habilitado conforme a determinação do responsável; ausência de execução é informada como tal. O aceite não confirma publicação nem conclusão do projeto.");
  return {
    html: '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>body{font:14px/1.5 Arial,sans-serif;color:#182b38;margin:24px}h1{font-size:24px}h2{font-size:20px;margin-top:28px}h3{font-size:16px;margin-top:20px}table{border-collapse:collapse;width:100%;font-size:12px;margin:12px 0 20px}th{background:#e9f0f5}th,td{border:1px solid #c9d4de;text-align:left;vertical-align:top;overflow-wrap:anywhere}tr:nth-child(even){background:#f7f9fb}</style></head><body>' + html.join("") + "</body></html>",
    text: text.join("\n"),
    svg: treeSvg,
    csv: "\uFEFF" + csvRows.map((row) => row.map((value) => { const v = safeText(value); return '"' + (/^[=+@-]/.test(v) ? "'" : "") + v.replaceAll('"', '""') + '"'; }).join(";")).join("\r\n"),
  };
}

export function slotId(now = Date.now()) {
  return new Date(Math.floor(now / PERIOD) * PERIOD).toISOString().replace(/[:.]/g, "-");
}

function writePrivate(file, value) {
  const temp = `${file}.${process.pid}.tmp`;
  writeFileSync(temp, value, { mode: 0o600, flag: "wx" });
  renameSync(temp, file);
}

export async function deliver(data, bodies, { now = Date.now(), directory = ROOT, fetchImpl = fetch, key, monitor = () => {} } = {}) {
  if (!data.active) return { state: "inactive_no_email" };
  const slot = slotId(now), slots = join(directory, "slots");
  mkdirSync(slots, { recursive: true, mode: 0o700 });
  const path = join(slots, slot + ".json");
  const meta = { slot, at: new Date(now).toISOString(), recipient: OWNER, state: "started_no_automatic_retry", generated_at: data.generated_at };
  try { writeFileSync(path, JSON.stringify(meta, null, 2), { mode: 0o600, flag: "wx" }); }
  catch (error) { if (error.code === "EEXIST") return { state: "slot_already_attempted", slot }; throw error; }
  const subject = `Andamento da petição — ${time(data.generated_at)}`;
  let result;
  try {
    if (!key) throw new Error("missing_mail_key");
    const attachments = data.tree?.available && bodies.csv ? [{ filename: "progresso-admin-v2.csv", content: Buffer.from(bodies.csv).toString("base64"), disposition: "attachment" }, ...(bodies.svg ? [{ filename: "arvore-admin-v2.svg", content: Buffer.from(bodies.svg).toString("base64"), disposition: "attachment" }] : [])] : [];
    meta.attachments = attachments.map((a) => ({ filename: a.filename, bytes: Buffer.from(a.content, "base64").length, sha256: createHash("sha256").update(Buffer.from(a.content, "base64")).digest("hex") }));
    const response = await fetchImpl("https://api.mailersend.com/v1/email", {
      method: "POST", headers: { Authorization: "Bearer " + key, "content-type": "application/json" },
      body: JSON.stringify({ from: { email: "adunir@envia.sancionaintegral.org", name: "Vigia — andamento da petição" }, to: [{ email: OWNER }], reply_to: { email: "ponte@painel.sancionaintegral.org" }, subject, html: bodies.html, text: bodies.text, ...(attachments.length ? { attachments } : {}) }),
      signal: AbortSignal.timeout(60000),
    });
    result = { ...meta, provider: "mailersend", status: response.status, id: response.headers.get("x-message-id"), state: response.ok ? "accepted_by_provider" : "rejected_by_provider", delivery: "Não comprovada pelo aceite" };
    if (!response.ok) result.error_summary = "Resposta HTTP " + response.status + "; consultar o provedor sem repetir este ciclo.";
  } catch (error) {
    result = { ...meta, state: error.message === "missing_mail_key" ? "configuration_error_no_send" : "uncertain_no_automatic_retry", error_type: error.name, phase: error.reportPhase ?? "local_generation", code: typeof error.code === "string" ? error.code : undefined, signal: error.signal ?? undefined };
  }
  writePrivate(path, JSON.stringify(result, null, 2));
  writePrivate(join(directory, "last-result.json"), JSON.stringify(result, null, 2));
  if (result.status) monitor({ para: OWNER, assunto: subject, result });
  return result;
}

async function main(args) {
  const send = args.includes("--send");
  const fixtureIndex = args.indexOf("--fixture");
  if (send && fixtureIndex >= 0) throw new Error("Fixture reports cannot be sent");
  let data;
  try { data = fixtureIndex >= 0 ? JSON.parse(readFileSync(args[fixtureIndex + 1], "utf8")) : JSON.parse(execFileSync("/usr/bin/python3", [join(ROOT, "collect.py")], { encoding: "utf8", timeout: 25000, maxBuffer: 2 * 1024 * 1024 })); }
  catch(error) { error.reportPhase = "collect_read_only"; throw error; }
  if (fixtureIndex < 0) {
    try { data.coordination = JSON.parse(execFileSync("/usr/bin/python3", ["/mnt/apps/peticao-final/_ops/coordenacao-dupla/tools/collect_report_coordination.py"], {encoding:"utf8",timeout:10000,maxBuffer:512*1024})); }
    catch { data.coordination = {available:false,read_error:"Metadados de coordenação indisponíveis"}; }
    if (data.coordination?.enabled === true) data.active = true;
  }
  mkdirSync(ROOT, { recursive: true, mode: 0o700 });
  if (!data.active && send) {
    console.log(JSON.stringify({ state: "inactive_no_email" }));
    return;
  }
  const bodies = renderReport(data);
  writePrivate(join(ROOT, fixtureIndex >= 0 ? "preview-ficticio.html" : "latest-report.html"), bodies.html);
  writePrivate(join(ROOT, fixtureIndex >= 0 ? "preview-ficticio.txt" : "latest-report.txt"), bodies.text);
  writePrivate(join(ROOT, fixtureIndex >= 0 ? "preview-ficticio.csv" : "latest-report.csv"), bodies.csv);
  if (bodies.svg) writePrivate(join(ROOT, fixtureIndex >= 0 ? "preview-ficticio.svg" : "latest-report.svg"), bodies.svg);
  if (!send) { console.log(JSON.stringify({ state: "dry_run_no_email", active: data.active, html_bytes: Buffer.byteLength(bodies.html) })); return; }
  const { getKey } = await import("/mnt/apps/peticao-final/peticao/tools/infra/lib/keystore.mjs");
  const { registrarEnvioMonitor } = await import("/mnt/apps/peticao-final/peticao/tools/ponte/monitor-historico.mjs");
  const result = await deliver(data, bodies, { key: getKey("MAILERSEND_API_TOKEN"), monitor: registrarEnvioMonitor });
  console.log(JSON.stringify({ state: result.state, status: result.status, id: result.id, slot: result.slot }));
  if (!["accepted_by_provider", "slot_already_attempted"].includes(result.state)) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main(process.argv.slice(2)).catch((error) => { console.error(JSON.stringify({ state: "local_report_error", error_type: error.name, phase: error.reportPhase ?? "local_generation", code: typeof error.code === "string" ? error.code : undefined, signal: error.signal ?? undefined })); process.exitCode = 1; });
