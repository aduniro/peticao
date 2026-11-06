import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASSUNTO_CARD, enviarCaso, mensagensDoCaso } from "../ponte/respostas-lib.mjs";

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "respostas-")) + "/";
  mkdirSync(dir + "previas");
  writeFileSync(dir + "previas/indice.json", JSON.stringify([{ n: 7, nome: "Breno Teste", email: "breno@exemplo.test", assunto: "Re: x (card)" }]));
  writeFileSync(dir + "primeiro-modelo.json", JSON.stringify({ 7: { nome: "Breno Teste", email: "breno@exemplo.test", assunto: "Re: e-mail de confirmação", texto: "Olá, Breno,\n\nCorpo.\n\nUm abraço,\nADUNIR · ANDES-SN\nPetição pela sanção integral do PLV nº 12/2026" } }));
  writeFileSync(dir + "previas/caso-7.html", "<html><body>card /api/cartaz/ABC123.png</body></html>");
  writeFileSync(dir + "previas/caso-7.txt", "versão em texto do card");
  return dir;
}

test("cada caso gera dois e-mails: só texto (primeiro modelo, sem HTML) e depois o card", () => {
  const { para, mensagens } = mensagensDoCaso(7, fixture());
  assert.equal(para, "breno@exemplo.test");
  assert.deepEqual(mensagens.map((m) => m.versao), ["texto", "card"]);
  assert.equal(mensagens[0].html, undefined);
  assert.match(mensagens[0].texto, /ADUNIR · ANDES-SN\nPetição pela sanção integral do PLV nº 12\/2026$/);
  assert.equal(mensagens[0].assunto, "Re: e-mail de confirmação");
  assert.ok(mensagens[1].html.includes("/api/cartaz/ABC123.png"));
  assert.equal(mensagens[1].assunto, ASSUNTO_CARD);
  assert.notEqual(mensagens[0].assunto, mensagens[1].assunto);
  assert.throws(() => mensagensDoCaso(99, fixture()), /desconhecido/);
});

test("envio: ordem, intervalo entre os dois, Reply-To e cópia oculta, registro e nunca duplica", async () => {
  const dir = fixture(), chamadas = [], esperas = [], registro = {}; let salvos = 0;
  const base = { dir, registro, salvar: () => salvos++, esperar: async (ms) => esperas.push(ms), intervaloMs: 60000, log: () => {}, enviar: async (o) => (chamadas.push(o), { status: 202, id: "id" + chamadas.length }) };
  assert.deepEqual(await enviarCaso(7, base), { ok: true });
  assert.equal(chamadas.length, 2); assert.deepEqual(esperas, [60000]);
  assert.equal(chamadas[0].html, undefined); assert.ok(chamadas[1].html);
  for (const c of chamadas) { assert.equal(c.para, "breno@exemplo.test"); assert.equal(c.replyTo, "operator-1608598f41@example.invalid"); assert.equal(c.bcc, "operator-1608598f41@example.invalid"); assert.equal(c.deNome, "Campanha Sanção Integral · ADUNIR"); }
  assert.equal(salvos, 2); assert.deepEqual(Object.keys(registro[7]).sort(), ["card", "texto"]);
  await enviarCaso(7, base); // segunda vez: nada novo
  assert.equal(chamadas.length, 2);
});

test("envio: falha no primeiro e-mail para ali e não registra; depois reenvia só o que faltou", async () => {
  const dir = fixture(), registro = {}; let n = 0; const chamadas = [];
  const enviar = async (o) => (chamadas.push(o.assunto), ++n === 1 ? { status: 500, erro: "boom" } : { status: 202, id: "x" });
  const base = { dir, registro, salvar: () => {}, esperar: async () => {}, log: () => {}, enviar };
  assert.deepEqual(await enviarCaso(7, base), { ok: false, versao: "texto" });
  assert.equal(chamadas.length, 1); assert.deepEqual(registro[7], {});
  assert.deepEqual(await enviarCaso(7, base), { ok: true }); // tenta de novo os dois
  assert.equal(chamadas.length, 3);
  const parcial = { 7: { texto: { em: "x" } } }, c2 = [];
  await enviarCaso(7, { ...base, registro: parcial, enviar: async (o) => (c2.push(o.assunto), { status: 202 }) });
  assert.deepEqual(c2, [ASSUNTO_CARD]); // o texto já tinha saído: só falta o card, sem esperar
});
