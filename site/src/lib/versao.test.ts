import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

(process.env as Record<string, string>).NODE_ENV = "test";

test("versão implantada: lê VERSAO e MUDANCAS (até 25 linhas, sem vazias); sem arquivos, 'desconhecida'", async () => {
  const { versaoImplantada } = await import("./versao");
  const antes = process.cwd(), dir = mkdtempSync(join(tmpdir(), "versao-"));
  try {
    process.chdir(dir);
    assert.deepEqual(versaoImplantada(), { versao: "desconhecida", fonte: "-", mudancas: [] });
    writeFileSync(join(dir, "VERSAO"), "abc123def456\n");
    assert.deepEqual(versaoImplantada(), { versao: "abc123def456", fonte: "VERSAO", mudancas: [] });
    writeFileSync(join(dir, "MUDANCAS"), Array.from({ length: 40 }, (_, i) => (i % 5 === 4 ? "" : `h${i} Alteração ${i}`)).join("\n"));
    const v = versaoImplantada();
    assert.equal(v.mudancas.length, 25); assert.equal(v.mudancas[0], "h0 Alteração 0"); assert.ok(v.mudancas.every(Boolean));
  } finally { process.chdir(antes); }
});

test("Terminal ligado: o dono recebe e-mail com quem ligou, até quando e o que fazer se não foi ele", async () => {
  process.env.MAIL_PROVIDER = "dev"; delete process.env.MAIL_PROVIDERS;
  const saida = mkdtempSync(join(tmpdir(), "term-aviso-")); process.env.MAIL_OUTBOX_DIR = saida; process.env.CONTACT_BCC = "dono@exemplo.org";
  const { avisarTerminalLigado } = await import("./acoes/terminal");
  assert.equal(await avisarTerminalLigado("dona@exemplo.org", new Date(Date.now() + 20 * 60_000), 20), true);
  const arqs = readdirSync(saida).filter((f) => f.endsWith(".json")); assert.equal(arqs.length, 1);
  const m = JSON.parse(readFileSync(join(saida, arqs[0]), "utf8"));
  assert.equal(m.to, "dono@exemplo.org"); assert.match(m.subject, /Terminal do painel LIGADO por dona@exemplo\.org/);
  assert.match(m.text, /por 20 minutos/); assert.match(m.text, /desligue agora/); assert.match(m.text, /sem acesso às senhas do site/);
  delete process.env.CONTACT_BCC;
});
