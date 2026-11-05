import test from "node:test";
import assert from "node:assert/strict";
import { ordemRodizio, parsePesos, registrar, aberto, _resetRodizio } from "./mail/rodizio";

const CADEIA = ["ses", "sendpulse", "mailersend", "brevo"];
test("pesos: leitura e rejeição de lixo", () => {
  assert.deepEqual(parsePesos("ses:6, SendPulse:3 ,mailersend:1"), { ses: 6, sendpulse: 3, mailersend: 1 });
  assert.equal(parsePesos(""), null); assert.equal(parsePesos("x:0,y:-1,z:abc"), null);
});
test("sem pesos mantém a ordem da cadeia (comportamento antigo)", () => { _resetRodizio(); assert.deepEqual(ordemRodizio("t", CADEIA, null), CADEIA); });
test("rodízio ponderado: proporção exata e sem rajadas", () => {
  _resetRodizio(); const p = parsePesos("ses:6,sendpulse:3,mailersend:1")!; const c: Record<string, number> = {}; const seq: string[] = [];
  for (let i = 0; i < 1000; i++) { const o = ordemRodizio("t", CADEIA, p); c[o[0]] = (c[o[0]] ?? 0) + 1; seq.push(o[0]); assert.equal(new Set(o).size, 4); assert.deepEqual([...o].sort(), [...CADEIA].sort()); }
  assert.equal(c.ses, 600); assert.equal(c.sendpulse, 300); assert.equal(c.mailersend, 100); assert.ok(!c.brevo);
  let maxSeq = 1, cur = 1; for (let i = 1; i < seq.length; i++) { cur = seq[i] === seq[i - 1] ? cur + 1 : 1; maxSeq = Math.max(maxSeq, cur); } assert.ok(maxSeq <= 3);
});
test("evitar: o serviço que já enviou vai para o fim", () => {
  _resetRodizio(); const p = parsePesos("ses:1,sendpulse:1,mailersend:1")!;
  for (let i = 0; i < 30; i++) { const o = ordemRodizio("t", CADEIA, p, { evitar: ["ses"] }); assert.notEqual(o[0], "ses"); assert.equal(o[o.length - 1], "ses"); }
  const so = ordemRodizio("t", ["ses"], parsePesos("ses:1"), { evitar: ["ses"] }); assert.deepEqual(so, ["ses"]); // sem alternativa: usa o mesmo, não perde o envio
});
test("disjuntor: 3 falhas seguidas tiram o serviço do rodízio por 5 min; sucesso zera", () => {
  _resetRodizio(); const p = parsePesos("ses:1,sendpulse:1")!; const t0 = 1_000_000;
  registrar("t", "ses", false, t0); registrar("t", "ses", false, t0); assert.ok(!aberto("t", "ses", t0));
  registrar("t", "ses", false, t0); assert.ok(aberto("t", "ses", t0 + 1000));
  for (let i = 0; i < 20; i++) assert.equal(ordemRodizio("t", ["ses", "sendpulse"], p, { agora: t0 + 1000 })[0], "sendpulse");
  assert.ok(!aberto("t", "ses", t0 + 6 * 60_000));
  registrar("t", "sendpulse", false, t0); registrar("t", "sendpulse", true, t0); registrar("t", "sendpulse", false, t0); registrar("t", "sendpulse", false, t0); assert.ok(!aberto("t", "sendpulse", t0));
});
