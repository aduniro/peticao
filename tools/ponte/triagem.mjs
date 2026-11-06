// Triagem automática das mensagens de contato dos usuários (SOMENTE LEITURA no servidor).
// Procura no banco de produção as mensagens de contato que ainda não foram vistas (inclusive as que chegaram enquanto o vigia estava desligado),
// reúne as evidências (cadastro sem CPF, e-mails enviados, devoluções, bloqueio, fila, saúde do app e registros do servidor), classifica o relato,
// diz se procede e por quê, e manda UM e-mail de relatório ao DONO, com proposta de resolução e rascunho de resposta. Nunca escreve no servidor
// e nunca envia nada à pessoa que escreveu.
// Uso: node triagem.mjs [--simular]   (--simular: mostra o relatório e não envia nem marca como visto)
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { enviar } from "./enviar.mjs";
import { analisar, baseDaPrimeiraExecucao, mascarar, montarRelatorio } from "./triagem-lib.mjs";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const ESTADO = RAIZ + ".cache/ponte/triagem.json";
const LOTE = 12; // no máximo 12 mensagens por rodada (o resto vai na rodada seguinte)
const SSH = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "peticao-root"];
const lerEstado = () => { try { return JSON.parse(readFileSync(ESTADO, "utf8")); } catch { return null; } };
const gravarEstado = (e) => { mkdirSync(dirname(ESTADO), { recursive: true }); writeFileSync(ESTADO, JSON.stringify(e)); };

/** Consulta SOMENTE LEITURA ao banco do servidor (a sessão do banco é aberta como somente leitura; o SQL é fixo, só o e-mail entra, validado). */
export function psql(sql) {
  const out = execFileSync("ssh", [...SSH, "runuser -u postgres -- psql -d peticao -X -q -t -A -v ON_ERROR_STOP=1"], { input: `SET default_transaction_read_only = on;\n${sql}\n`, encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 }).trim();
  return out ? JSON.parse(out) : null;
}
const tentar = (fn) => { try { return fn(); } catch { return null; } };
const EMAIL_OK = /^[a-z0-9._%+-]{1,64}@[a-z0-9.-]{1,120}\.[a-z]{2,}$/;

function buscarMensagens(estado) {
  const filtro = estado ? `WHERE id > ${Number(estado.ultimoId) || 0}` : "";
  const ordem = estado ? "ORDER BY id" : "ORDER BY id DESC";
  const lim = estado ? LOTE : 300;
  return psql(`SELECT COALESCE(json_agg(t ORDER BY id), '[]') FROM (SELECT id, name, email, kind, message, locale, mailed, created_at FROM contact_messages ${filtro} ${ordem} LIMIT ${lim}) t;`) ?? [];
}

/** Evidências de UMA mensagem. Cada consulta é independente: se uma tabela não existir na versão publicada, aquela evidência fica vazia (nunca derruba o resto). */
function evidencias(m) {
  const e = String(m.email ?? "").trim().toLowerCase();
  if (!EMAIL_OK.test(e)) return { cadastro: null, envios: [], devolucoes: [], supressao: null, fila: null, reenvio: null, emailInvalido: true };
  const q = (s) => s.replace(/\$E/g, e.replace(/'/g, "''"));
  return {
    cadastro: tentar(() => psql(q("SELECT to_jsonb(s) - 'cpf_hash' - 'wa_cipher' - 'wa_fp' - 'token_hash' - 'verify_code' FROM signatures s WHERE lower(s.email) = '$E' ORDER BY s.id DESC LIMIT 1;"))),
    envios: tentar(() => psql(q("SELECT COALESCE(json_agg(t), '[]') FROM (SELECT ts, provider, status, kind, error FROM mail_log WHERE lower(to_addr) = '$E' AND ts > now() - interval '14 days' ORDER BY ts DESC LIMIT 30) t;"))) ?? [],
    devolucoes: tentar(() => psql(q("SELECT COALESCE(json_agg(t), '[]') FROM (SELECT ts, provider, type, reason FROM mail_events WHERE lower(email) = '$E' ORDER BY ts DESC LIMIT 10) t;"))) ?? [],
    supressao: tentar(() => psql(q("SELECT row_to_json(x) FROM (SELECT reason, detail, created_at FROM email_suppressions WHERE lower(email) = '$E') x;"))),
    fila: tentar(() => psql(q("SELECT json_build_object('pendentes', COUNT(*) FILTER (WHERE status = 'pending'), 'falhos', COUNT(*) FILTER (WHERE status = 'failed')) FROM mail_outbox WHERE lower(to_addr) = '$E';"))),
    reenvio: tentar(() => psql(q("SELECT row_to_json(x) FROM (SELECT r.status, r.provider, r.enviado_em FROM reenvio_falha r JOIN signatures s ON s.id = r.signature_id WHERE lower(s.email) = '$E' LIMIT 1) x;"))),
  };
}

/** Saúde do app: serviços, erros do registro do servidor nas últimas 24 h (agrupados e sem dados pessoais), fila de e-mails e taxa de falha de envio. */
export function saudeDoApp() {
  const ssh = (cmd) => execFileSync("ssh", [...SSH, cmd], { encoding: "utf8", timeout: 60_000, maxBuffer: 8 * 1024 * 1024 });
  try {
    const ativo = (u) => tentar(() => ssh(`systemctl is-active ${u}`).trim()) ?? "desconhecido";
    const servico = { site: ativo("peticao"), agendador: ativo("peticao-agendador.timer") };
    const linhas = (tentar(() => ssh(`journalctl -u peticao --since "24 hours ago" -p err -o cat --no-pager | tail -n 500`)) ?? "").split("\n").filter(Boolean);
    const grupos = new Map();
    for (const l of linhas) { const k = mascarar(l).replace(/\d{2,}/g, "N").slice(0, 140); grupos.set(k, (grupos.get(k) ?? 0) + 1); }
    const padroes = [...grupos.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([msg, n]) => ({ msg, n }));
    const db = tentar(() => psql("SELECT json_build_object('outbox', (SELECT json_build_object('pending', COUNT(*) FILTER (WHERE status='pending'), 'failed', COUNT(*) FILTER (WHERE status='failed')) FROM mail_outbox), 'envios24h', (SELECT json_build_object('sent', COUNT(*) FILTER (WHERE status='sent'), 'failed', COUNT(*) FILTER (WHERE status='failed')) FROM mail_log WHERE ts > now() - interval '24 hours'));")) ?? {};
    return { servico, erros24h: linhas.length, padroes, outbox: db.outbox, envios24h: db.envios24h };
  } catch { return null; }
}

/**
 * Uma rodada: busca o que é novo, analisa, manda o relatório ao dono e só então marca como visto.
 * Devolve { novos, ids, vereditos } ou { erro } (sem acesso ao servidor, por exemplo: nada é marcado, tenta de novo na próxima rodada).
 */
export async function triagemUmaVez({ simular = false, log = () => {} } = {}) {
  let estado = lerEstado(), mensagens;
  try { mensagens = buscarMensagens(estado); } catch (e) { return { erro: `sem acesso ao servidor: ${String(e.message ?? e).split("\n")[0].slice(0, 140)}` }; }
  if (!estado) { // primeira vez: o que chegou antes de 05/11 12h já foi tratado à mão; só o que veio depois entra (DESDE_PADRAO)
    const base = baseDaPrimeiraExecucao(mensagens);
    estado = { ultimoId: base.ultimoId, iniciadoEm: new Date().toISOString() };
    mensagens = mensagens.filter((x) => base.processar.includes(x.id)).sort((a, b) => a.id - b.id).slice(0, LOTE);
    if (!simular) gravarEstado(estado);
  }
  if (!mensagens.length) { if (!simular) gravarEstado({ ...estado, ultimaRodada: new Date().toISOString() }); return { novos: 0, ids: [], vereditos: [] }; }
  const agora = new Date().toISOString(), saude = saudeDoApp();
  const itens = mensagens.map((m) => ({ msg: m, analise: analisar({ agora, msg: m, ...evidencias(m), saude }) }));
  const rel = montarRelatorio(itens, { saude, geradoEm: agora });
  if (simular) { log(rel.texto); return { novos: itens.length, ids: itens.map((i) => i.msg.id), vereditos: itens.map((i) => i.analise.veredito), simulado: true }; }
  const r = await enviar({ assunto: rel.assunto, html: rel.html, texto: rel.texto, deNome: "Vigia da campanha (triagem)" });
  if (!r.status || r.status >= 300) return { erro: `o relatório não foi enviado (${r.erro ?? r.status}); tento de novo na próxima rodada` };
  try { mkdirSync(RAIZ + ".cache/ponte/triagem", { recursive: true }); writeFileSync(`${RAIZ}.cache/ponte/triagem/${agora.replace(/[:.]/g, "-")}.json`, JSON.stringify({ itens, saude }, null, 1)); } catch { /* o registro local é só conveniência */ }
  gravarEstado({ ...estado, ultimoId: Math.max(...mensagens.map((x) => x.id)), ultimaRodada: agora });
  return { novos: itens.length, ids: itens.map((i) => i.msg.id), vereditos: itens.map((i) => i.analise.veredito), enviado: true };
}

if (process.argv[1]?.endsWith("triagem.mjs")) {
  const simular = process.argv.includes("--simular");
  const r = await triagemUmaVez({ simular, log: console.log });
  console.log(JSON.stringify({ triagem: r.erro ? "erro" : simular ? "simulado" : "ok", ...r }));
}
