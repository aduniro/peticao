import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deliver, OWNER, renderReport, safeText, slotId } from "./report.mjs";

const sample = {
  active: true, generated_at: "2026-11-09T13:00:00Z",
  primary_tasks: [{ id: "fake", title: "Tarefa fictícia <script>alert(1)</script>", state: "running", stage: "Evidência fictícia pessoa@example.invalid 529.982.247-25", scope: "Teste", environment: "Fictício", cwd: "/tmp/teste-ficticio", progress: 40, seconds_since_creation: 3661, eta: "Não estimado", updated_at: "2026-11-09T12:59:00Z", stale: false, steps: [{ id: "a", title: "Etapa fictícia", state: "completed", progress: 100 }] }],
  other_running: [], paused_waiting: [], git: { path: "/tmp/ficticio", branch: "teste", head: "abc123", subject: "Teste", modified_app_paths: 0 }, qa: [], normalization: [],
};

test("HTML rico escapa valores e omite endereços/CPF; não usa Markdown no corpo HTML", () => {
  const result = renderReport(sample);
  assert.match(result.html, /<table/);
  assert.match(result.html, /&lt;script&gt;/);
  assert.doesNotMatch(result.html, /<script>|pessoa@example\.invalid|529\.982\.247-25/);
  assert.doesNotMatch(result.text, /pessoa@example\.invalid|529\.982\.247-25/);
  assert.match(result.text, /40,0%/);
  assert.equal(safeText("token=abc123"), "token=[omitido]");
});

test("slots seguem janelas UTC de uma hora", () => {
  assert.equal(slotId(Date.parse("2026-11-09T13:00:00Z")), slotId(Date.parse("2026-11-09T13:59:59Z")));
  assert.notEqual(slotId(Date.parse("2026-11-09T13:59:59Z")), slotId(Date.parse("2026-11-09T14:00:00Z")));
});

test("envia só ao dono, sem anexos, e não repete slot aceito", async () => {
  const directory = mkdtempSync(join(tmpdir(), "peticao-report-test-"));
  let calls = 0, monitorCalls = 0;
  try {
    const options = { directory, now: Date.parse(sample.generated_at), key: "FICTITIOUS", monitor: (result) => { monitorCalls++; assert.equal(result.para, OWNER); }, fetchImpl: async (url, request) => {
      calls++;
      assert.equal(url, "https://api.mailersend.com/v1/email");
      const payload = JSON.parse(request.body);
      assert.deepEqual(payload.to, [{ email: OWNER }]);
      assert.equal(payload.cc, undefined); assert.equal(payload.bcc, undefined); assert.equal(payload.attachments, undefined);
      assert.match(payload.html, /<table/); assert.ok(payload.text);
      return new Response(null, { status: 202, headers: { "x-message-id": "fictitious-test-id" } });
    } };
    assert.equal((await deliver(sample, renderReport(sample), options)).state, "accepted_by_provider");
    assert.equal((await deliver(sample, renderReport(sample), options)).state, "slot_already_attempted");
    assert.equal(calls, 1); assert.equal(monitorCalls, 1);
    const file = join(directory, "slots", readdirSync(join(directory, "slots"))[0]);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(JSON.parse(readFileSync(file)).id, "fictitious-test-id");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("envio incerto e rejeiçãoHTTP não são repetidos no mesmo slot", async () => {
  for (const uncertain of [true, false]) {
    const directory = mkdtempSync(join(tmpdir(), "peticao-report-test-"));
    let calls = 0;
    try {
      const options = { directory, now: Date.parse(sample.generated_at), key: "FICTITIOUS", fetchImpl: async () => { calls++; if (uncertain) throw new TypeError("Network failure"); return new Response(null, { status: 403 }); } };
      assert.equal((await deliver(sample, renderReport(sample), options)).state, uncertain ? "uncertain_no_automatic_retry" : "rejected_by_provider");
      assert.equal((await deliver(sample, renderReport(sample), options)).state, "slot_already_attempted");
      assert.equal(calls, 1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
});

test("frentes inativas não iniciam rede nem criam tentativa", async () => {
  const directory = mkdtempSync(join(tmpdir(), "peticao-report-test-"));
  try {
    assert.equal((await deliver({ ...sample, active: false }, renderReport(sample), { directory, fetchImpl: async () => { throw new Error("Must not run"); } })).state, "inactive_no_email");
    assert.equal(readdirSync(directory).length, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("chave ausente não tenta envio e mantém guarda do ciclo", async () => {
  const directory = mkdtempSync(join(tmpdir(), "peticao-report-test-"));
  try {
    const result = await deliver(sample, renderReport(sample), { directory, now: Date.parse(sample.generated_at), key: null, fetchImpl: async () => { throw new Error("Must not run"); } });
    assert.equal(result.state, "configuration_error_no_send");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

const tree = { available: true, percent: 50, snapshot_at: "2026-11-09T12:00:00Z", commit: "a".repeat(40), path: "/tmp/progresso.json", recorded_at: sample.generated_at, recorded_stale: true, state_policy: "Estados registrados; não prova agente ativo.", method: "Quatro marcos por funcionalidade.", sections: [{ id: "5", title: "Campanha", percent: 50, state: "em execução registrada", modules: [{ id: "5.2", title: "Presidente", percent: 50, state: "em execução registrada", functions: [{ id: "5.2.3", title: "Confirmação", percent: 50, state: "em execução registrada", note: "pessoa@example.invalid CPF529.982.247-25 token=secret", evidence: ["/tmp/prova.json"] }] }] }] };

test("árvore inclui níveis, snapshot antigo separado de HEAD e CSV protegido", () => {
 const result = renderReport({ ...sample, tree });
 assert.match(result.html, /Campanha/); assert.match(result.html, /Presidente/); assert.match(result.html, /Confirmação/);
 assert.match(result.html, /HEAD observado agora: abc123/); assert.match(result.html, /Alterações posteriores ao snapshot não herdam/);
 assert.match(result.html, /SEM ATUALIZAÇÃO RECENTE/);
 assert.match(result.csv, /Funcionalidade/); assert.match(result.csv, /aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa/);
 assert.doesNotMatch(result.csv + result.html, /pessoa@example.invalid|529\.982\.247-25|token=secret/);
});

test("reivindicação concorrente faz uma chamada, anexo CSV confere e hora seguinte permite relatório", async () => {
 const directory = mkdtempSync(join(tmpdir(), "peticao-hourly-tree-test-")); let calls = 0;
 try {
  const data = { ...sample, tree }, options = { directory, now: Date.parse(sample.generated_at), key: "FICTITIOUS", fetchImpl: async (_, request) => {
   calls++; const payload = JSON.parse(request.body); assert.deepEqual(payload.to, [{ email: OWNER }]);
   assert.equal(payload.attachments.length, 1); assert.equal(payload.attachments[0].filename, "progresso-admin-v2.csv");
   assert.equal(Buffer.from(payload.attachments[0].content, "base64").toString(), renderReport(data).csv);
   await new Promise((resolve) => setTimeout(resolve, 5)); return new Response(null, { status: 202 });
  } };
  const results = await Promise.all(Array.from({ length: 3 }, () => deliver(data, renderReport(data), options)));
  assert.equal(calls, 1); assert.equal(results.filter((r) => r.state === "slot_already_attempted").length, 2);
  assert.equal((await deliver(data, renderReport(data), { ...options, now: options.now + 3600000 })).state, "accepted_by_provider"); assert.equal(calls, 2);
 } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("reserva persistente de processo interrompido não é reenviada", async () => {
 const directory = mkdtempSync(join(tmpdir(), "peticao-hourly-reserve-test-"));
 try {
  const { mkdirSync, writeFileSync } = await import("node:fs"); const now = Date.parse(sample.generated_at);
  mkdirSync(join(directory, "slots")); writeFileSync(join(directory, "slots", slotId(now) + ".json"), JSON.stringify({ state: "started_no_automatic_retry" }));
  assert.equal((await deliver(sample, renderReport(sample), { directory, now, key: "FICTITIOUS", fetchImpl: async () => { throw new Error("must not call"); } })).state, "slot_already_attempted");
 } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("árvore normal usa cartões verdes, barras em todos níveis e SVG próprio sem percentuais de snapshot antigo", async () => {
 const live={...tree,source:"vigia_sqlite_read_only",path:"/tmp/monitor.sqlite",commit:"Vigia atual",percent:75};
 const data={...sample,tree:live},result=renderReport(data);
 assert.match(result.html,/Admin-v2 — árvore cumulativa/);assert.match(result.html,/#064e3b/);assert.match(result.html,/width:50%/);assert.match(result.html,/uma hora/);
 assert.match(result.html,/Marcos atuais: 75,0%/);assert.doesNotMatch(result.html,/Snapshot de|Alterações posteriores ao snapshot/);
 assert.match(result.svg,/<svg/);assert.match(result.svg,/Confirmação/);assert.doesNotMatch(result.svg+result.html+result.csv,/pessoa@example.invalid|token=secret/);
 const directory=mkdtempSync(join(tmpdir(),"peticao-live-tree-fictitious-"));let calls=0;
 try{await deliver(data,result,{directory,now:Date.parse(data.generated_at),key:"FICTITIOUS",fetchImpl:async(_,request)=>{calls++;const payload=JSON.parse(request.body);assert.deepEqual(payload.to,[{email:OWNER}]);assert.deepEqual(payload.attachments.map(a=>a.filename),["progresso-admin-v2.csv","arvore-admin-v2.svg"]);assert.equal(Buffer.from(payload.attachments[1].content,"base64").toString(),result.svg);return new Response(null,{status:202});}});assert.equal(calls,1);}finally{rmSync(directory,{recursive:true,force:true});}
});


test("relatorio horario inclui ambas sessoes, ACKs e leases sem confundir observacao com execucao", () => {
 const result=renderReport({...sample,coordination:{available:true,actors:[{id:"apoio",repos:["/tmp/publico"]},{id:"admin",repos:["/tmp/admin"]}],sessions:[{actor:"apoio",thread_id:"sessao-publica",last_activity_at:"2026-11-09T12:59:00Z",observation_state:"recent_activity",stale:false,last_tool_name:"exec",turn_state:"unknown"},{actor:"admin",thread_id:"sessao-admin",last_activity_at:"2026-11-09T11:00:00Z",observation_state:"stale",stale:true,last_tool_name:"exec",turn_state:"unknown"}],events:[{at:sample.generated_at,actor:"admin",kind:"notice",summary:"<script>pessoa@example.invalid token=SECRETO</script>"}],leases:[{actor:"apoio",operation:"edit",state:"active",resources:"/tmp/report",expires:1790000000}],pending_ack:[{seq:7,actor:"admin",missing_actor:"apoio",summary:"API/banco"}]}});
 assert.match(result.html,/sessao-publica/);assert.match(result.html,/sessao-admin/);assert.match(result.html,/SEM ATIVIDADE RECENTE/);assert.match(result.html,/ACK pendente/);assert.match(result.html,/não comprova processo em execução/);assert.doesNotMatch(result.html,/<script>|pessoa@example.invalid|SECRETO/);assert.match(result.html,/uma hora/);
});
