import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { analisar, alertasDoApp, baseDaPrimeiraExecucao, mascarar, montarRelatorio, primeiroNome, tipoDoRelato, VEREDITOS } from "../ponte/triagem-lib.mjs";

const AGORA = "2026-11-06T12:00:00.000Z";
const msg = (message, extra = {}) => ({ id: 7, name: "maria souza", email: "maria@exemplo.org", kind: "duvida", message, created_at: "2026-11-06T11:00:00.000Z", ...extra });
const base = (m, ev = {}) => ({ agora: AGORA, msg: m, cadastro: null, envios: [], devolucoes: [], supressao: null, fila: null, reenvio: null, saude: { servico: { site: "active", agendador: "active" }, erros24h: 0, padroes: [], outbox: { pending: 0, failed: 0 }, envios24h: { sent: 50, failed: 0 } }, ...ev });
const cad = (o = {}) => ({ status: "pending", created_at: "2026-11-05T10:00:00Z", confirmed_at: null, category: "servidor", token_expires_at: "2026-11-09T10:00:00Z", cpf_name_check: "match", ...o });
const enviado = (p = "mailersend", ts = "2026-11-05T10:01:00Z") => ({ ts, provider: p, status: "sent", kind: "confirmacao", error: null });

test("natureza do relato: palavras-chave, sem acento, ordem de prioridade", () => {
  assert.equal(tipoDoRelato("Não recebi o e-mail de confirmação"), "nao_recebeu");
  assert.equal(tipoDoRelato("nao chegou nada, olhei o spam"), "nao_recebeu");
  assert.equal(tipoDoRelato("o link expirou"), "expirou");
  assert.equal(tipoDoRelato("Quero cancelar minha assinatura e apagar meus dados, LGPD"), "remover");
  assert.equal(tipoDoRelato("meu CPF deu erro, o nome não confere"), "cpf");
  assert.equal(tipoDoRelato("digitei errado meu e-mail, quero corrigir"), "corrigir");
  assert.equal(tipoDoRelato("a página travou no celular", "bug"), "erro");
  assert.equal(tipoDoRelato("Onde vejo o texto do PLV?"), "duvida");
  assert.equal(tipoDoRelato("não recebi e quero remover meu nome da lista"), "remover"); // o mais sensível ganha
});

test("não recebeu: cada causa possível leva ao veredito certo", () => {
  const nr = msg("Não recebi o e-mail de confirmação");
  let a = analisar(base(nr));
  assert.equal(a.veredito, VEREDITOS.INCONCLUSIVO); assert.match(a.resposta, /Não encontramos um cadastro/);
  a = analisar(base(nr, { cadastro: cad({ status: "confirmed", confirmed_at: "2026-11-05T10:05:00Z" }) }));
  assert.equal(a.veredito, VEREDITOS.RESOLVIDO); assert.match(a.resposta, /já está contada/);
  a = analisar(base(nr, { cadastro: cad(), supressao: { reason: "bounce", detail: "550 mailbox full", created_at: "2026-11-05T10:02:00Z" } }));
  assert.equal(a.veredito, VEREDITOS.PROCEDE); assert.equal(a.causa, "sistema"); assert.ok(a.resolucao.some((x) => /bloqueio/.test(x)));
  a = analisar(base(nr, { cadastro: cad(), envios: [{ ...enviado(), status: "failed" }], devolucoes: [{ ts: "2026-11-05T10:03:00Z", provider: "ses", type: "hard_bounce", reason: "no such user" }] }));
  assert.equal(a.veredito, VEREDITOS.NAO); assert.equal(a.causa, "usuario"); assert.match(a.resposta, /outro e-mail/);
  a = analisar(base(nr, { cadastro: cad(), envios: [enviado()] }));
  assert.equal(a.veredito, VEREDITOS.NAO); assert.match(a.resposta, /spam/); assert.match(a.motivos.join(" "), /mailersend/);
  a = analisar(base(msg("não recebi", { email: "cilene@utfpr.edu.br" }), { cadastro: cad(), envios: [enviado()] }));
  assert.match(a.motivos.join(" "), /institucional/); assert.equal(a.confianca, "alta"); assert.match(a.resposta, /quarentena/);
  a = analisar(base(nr, { cadastro: cad({ token_expires_at: "2026-11-06T08:00:00Z" }), envios: [enviado()] }));
  assert.equal(a.veredito, VEREDITOS.PARCIAL); assert.match(a.resposta, /prazo de validade/);
  a = analisar(base(nr, { cadastro: cad(), envios: [{ ...enviado(), status: "queued" }] }));
  assert.equal(a.veredito, VEREDITOS.PARCIAL); assert.match(a.motivos.join(" "), /fila de reenvio/);
  a = analisar(base(nr, { cadastro: cad(), envios: [] }));
  assert.equal(a.veredito, VEREDITOS.PROCEDE); assert.equal(a.causa, "sistema"); assert.match(a.resposta, /falha nossa/);
  a = analisar(base(nr, { cadastro: cad(), envios: [{ ...enviado(), status: "failed", error: "SES: quota para ana@x.com" }] }));
  assert.equal(a.confianca, "alta"); assert.ok(!a.resolucao.join(" ").includes("ana@x.com"), "o erro registrado sai mascarado");
});

test("relatos de e-mail não aceito e de problema que já se resolveu sozinho", () => {
  assert.equal(tipoDoRelato("Nao está aceitando o e-mail institucional do IFC.", "bug"), "email_recusado");
  assert.equal(tipoDoRelato("o formulário diz que meu e-mail é inválido"), "email_recusado");
  const m = msg("Nao está aceitando o e-mail institucional do IFC.", { kind: "bug", created_at: "2026-11-05T12:54:00Z" });
  let a = analisar(base(m));
  assert.equal(a.veredito, VEREDITOS.PARCIAL); assert.equal(a.causa, "sistema"); assert.match(a.resolucao.join(" "), /\/admin\/dominios/);
  a = analisar(base(m, { cadastro: cad({ status: "confirmed", created_at: "2026-11-05T12:50:00Z", confirmed_at: "2026-11-05T12:55:00Z" }) }));
  assert.equal(a.veredito, VEREDITOS.RESOLVIDO); assert.match(a.motivos.join(" "), /DEPOIS da mensagem/); assert.match(a.resposta, /já está contada/);
  const nr = msg("O e-mail para confirmação não chega!", { created_at: "2026-11-05T18:18:00Z" });
  a = analisar(base(nr, { cadastro: cad({ created_at: "2026-11-05T18:20:00Z" }), envios: [enviado()] }));
  assert.match(a.motivos.join(" "), /anterior ao cadastro atual/);
});

test("CPF, correção, remoção, erro e dúvida", () => {
  let a = analisar(base(msg("meu cpf não confere"), { cadastro: cad({ cpf_name_check: "mismatch" }) }));
  assert.equal(a.veredito, VEREDITOS.PARCIAL); assert.match(a.resposta, /sem enviar o número/);
  a = analisar(base(msg("deu erro no cpf"), { cadastro: cad({ cpf_name_check: "match" }) }));
  assert.equal(a.veredito, VEREDITOS.RESOLVIDO);
  a = analisar(base(msg("errei meu nome, quero corrigir")));
  assert.equal(a.veredito, VEREDITOS.NAO_E_ERRO); assert.match(a.resolucao.join(" "), /datas originais/);
  a = analisar(base(msg("quero cancelar minha assinatura e apagar meus dados")));
  assert.equal(a.veredito, VEREDITOS.PRIORIDADE); assert.match(a.resolucao.join(" "), /Você decide/);
  a = analisar(base(msg("a página travou", { kind: "bug" }), {}));
  assert.equal(a.veredito, VEREDITOS.INCONCLUSIVO); assert.equal(a.causa, "usuario");
  a = analisar(base(msg("a página travou", { kind: "bug" }), { saude: { servico: { site: "active" }, erros24h: 9, padroes: [{ msg: "Erro em 12345 para a@b.com", n: 9 }], outbox: { pending: 0, failed: 0 }, envios24h: { sent: 10, failed: 0 } } }));
  assert.equal(a.veredito, VEREDITOS.PARCIAL); assert.equal(a.causa, "sistema"); assert.ok(!a.alertasApp.join(" ").includes("a@b.com"));
  a = analisar(base(msg("Onde vejo o texto do PLV?")));
  assert.equal(a.veredito, VEREDITOS.NAO_E_ERRO); assert.match(a.resposta, /Escreva aqui a resposta/);
});

test("toda resposta proposta tem saudação com o primeiro nome, assinatura da ADUNIR e nunca pede ou mostra CPF", () => {
  const casos = ["Não recebi o e-mail", "cancelar minha assinatura", "meu cpf não confere", "errei meu nome", "a página travou", "dúvida qualquer", "o link expirou"];
  for (const t of casos) {
    const a = analisar(base(msg(t), { cadastro: t === "o link expirou" ? cad({ token_expires_at: "2026-11-01T00:00:00Z" }) : cad() }));
    assert.match(a.resposta, /^Olá, Maria,/); assert.match(a.resposta, /ADUNIR · ANDES-SN\nPetição pela sanção integral do PLV nº 12\/2026$/);
    assert.ok(!/\d{3}\.\d{3}\.\d{3}-\d{2}/.test(a.resposta + a.motivos.join(" ")));
  }
  assert.equal(primeiroNome("  JOÃO carlos "), "João");
});

test("mascarar tira e-mails, CPFs, IPs e códigos longos dos registros", () => {
  const m = mascarar("falha para ana.silva@exemplo.org cpf 123.456.789-09 ip 200.10.20.30 token abcdefghijklmnopqrstuvwxyz0123456789");
  assert.ok(!/ana\.silva|123\.456|200\.10|abcdefghijkl/.test(m)); assert.match(m, /\[e-mail\].*\[cpf\].*\[ip\].*\[código\]/);
});

test("primeira execução: só entram as mensagens a partir do marco (05/11 12h, Rondônia); o resto já foi tratado", () => {
  const ms = [{ id: 5, created_at: "2026-11-03T20:00:00-03:00" }, { id: 13, created_at: "2026-11-04T23:36:00-03:00" }, { id: 15, created_at: "2026-11-05T10:28:00-03:00" }, { id: 16, created_at: "2026-11-05T13:31:00-03:00" }, { id: 18, created_at: "2026-11-05T19:10:00-03:00" }];
  assert.deepEqual(baseDaPrimeiraExecucao([]), { ultimoId: 0, processar: [] });
  assert.deepEqual(baseDaPrimeiraExecucao(ms), { ultimoId: 15, processar: [16, 18] });
  assert.deepEqual(baseDaPrimeiraExecucao(ms.slice(0, 3)), { ultimoId: 15, processar: [] }); // tudo anterior ao marco: nada a processar
  assert.deepEqual(baseDaPrimeiraExecucao(ms, "2026-11-01T00:00:00-03:00").processar, [5, 13, 15, 16, 18]); // marco configurável
});

test("o relatório nunca leva CPF: o que a pessoa escreveu na mensagem sai mascarado (texto e HTML)", () => {
  const m = msg("Gostaria de retificar. Meu CPF é 800.000.003-29 e também 80000000329, e-mail maria@exemplo.org");
  const r = montarRelatorio([{ msg: m, analise: analisar(base(m, { cadastro: cad({ cpf_name_check: "mismatch" }) })) }], { saude: base(m).saude, geradoEm: AGORA });
  for (const t of [r.texto, r.html, r.assunto]) assert.ok(!/800\.?000\.?003-?29/.test(t), "CPF vazou");
  assert.match(r.texto, /\[CPF omitido\]/); assert.match(r.texto, /maria@exemplo\.org/);
});

test("relatório ao dono: assunto, evidências, resolução, resposta; HTML escapado; saúde do app", () => {
  const i1 = { msg: msg("Não recebi <b>nada</b>"), analise: analisar(base(msg("Não recebi <b>nada</b>"), { cadastro: cad(), envios: [] })) };
  const i2 = { msg: msg("Onde vejo o texto?", { id: 8 }), analise: analisar(base(msg("Onde vejo o texto?", { id: 8 }))) };
  const r = montarRelatorio([i1, i2], { saude: i1.analise && base(msg("x")).saude, geradoEm: AGORA });
  assert.match(r.assunto, /^\[ATENÇÃO\] Triagem: 2 mensagem\(ns\)/);
  for (const parte of ["Caso 1 de 2", "VEREDITO:", "Por quê (evidências):", "Proposta de resolução:", "Proposta de resposta à pessoa", "Saúde do app", "nada foi enviado às pessoas"]) assert.ok(r.texto.includes(parte), parte);
  assert.ok(r.html.includes("&lt;b&gt;nada&lt;/b&gt;") && !r.html.includes("<b>nada</b>"), "o texto do usuário não vira HTML");
  assert.match(alertasDoApp(null)[0], /Não foi possível consultar/);
  assert.match(alertasDoApp(base(msg("x")).saude)[0], /^Nada anormal/);
  const ruim = alertasDoApp({ servico: { site: "failed" }, erros24h: 3, padroes: [{ msg: "boom", n: 3 }], outbox: { pending: 9, failed: 2 }, envios24h: { sent: 5, failed: 5 } });
  assert.equal(ruim.length, 4);
  const calmo = montarRelatorio([i2], { saude: base(msg("x")).saude, geradoEm: AGORA });
  assert.ok(!calmo.assunto.startsWith("[ATENÇÃO]"));
});

test("a triagem só LÊ o servidor: nenhum comando de escrita e a sessão do banco é somente leitura", () => {
  const fonte = readFileSync(new URL("../ponte/triagem.mjs", import.meta.url), "utf8");
  assert.match(fonte, /SET default_transaction_read_only = on/);
  const sqls = [...fonte.matchAll(/(?:psql|q)\(\s*(?:q\()?\s*["`]([\s\S]*?)["`]\s*\)/g)].map((x) => x[1]).filter((s) => /SELECT/i.test(s));
  assert.ok(sqls.length >= 8, `achei ${sqls.length} consultas`);
  for (const s of sqls) assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT|COPY)\b/i.test(s), s.slice(0, 80));
  assert.ok(!/cpf_hash|wa_cipher/.test(fonte.replace(/- 'cpf_hash' - 'wa_cipher'[^;]*/, "")), "só aparecem para serem REMOVIDOS da consulta");
  assert.match(fonte, /EMAIL_OK/);
  const vigia = readFileSync(new URL("../ponte/vigia.mjs", import.meta.url), "utf8");
  assert.match(vigia, /triagemUmaVez/); assert.match(vigia, /ao ligar/);
});
