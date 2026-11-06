import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const RUNNER = join(__dirname, "../../../deploy/peticao-publicar-executar.sh");
function ambiente(deployCodigo = 0) {
  const raiz = mkdtempSync(join(tmpdir(), "publicar-")), pedidos = join(raiz, "var-lib-peticao"), estado = join(raiz, "estado");
  mkdirSync(pedidos); mkdirSync(estado);
  const deploy = join(raiz, "deploy-falso.sh");
  writeFileSync(deploy, `#!/usr/bin/env bash\necho "implantando..."\ndate +%s >> "${join(raiz, "chamadas")}"\nexit ${deployCodigo}\n`); chmodSync(deploy, 0o755);
  const env = { ...process.env, PUBLICAR_PEDIDO: join(pedidos, "publicar.pedido"), PUBLICAR_ESTADO_DIR: estado, PUBLICAR_DEPLOY: deploy, PUBLICAR_LOCK: join(raiz, "lock"), PUBLICAR_MAX_IDADE: "900" };
  const rodar = () => execFileSync("bash", [RUNNER], { env, stdio: "pipe" });
  const chamadas = () => (existsSync(join(raiz, "chamadas")) ? readFileSync(join(raiz, "chamadas"), "utf8").trim().split("\n").length : 0);
  const estadoJson = () => JSON.parse(readFileSync(join(estado, "publicar.estado"), "utf8"));
  return { raiz, env, rodar, chamadas, estadoJson, pedido: env.PUBLICAR_PEDIDO };
}
const noEnv = (e: { env: NodeJS.ProcessEnv }) => { for (const k of ["PUBLICAR_PEDIDO", "PUBLICAR_ESTADO_DIR"]) process.env[k] = e.env[k]; delete process.env.PREVIEW_MODE; };

test("executor: sem pedido não faz nada; com pedido válido roda o deploy uma vez e apaga o sinal", () => {
  const a = ambiente();
  a.rodar(); assert.equal(a.chamadas(), 0); assert.equal(existsSync(join(a.env.PUBLICAR_ESTADO_DIR!, "publicar.estado")), false);
  writeFileSync(a.pedido, JSON.stringify({ id: "0123456789abcdef", por: "dona@exemplo.org" }) + "\n");
  a.rodar();
  assert.equal(a.chamadas(), 1); assert.equal(existsSync(a.pedido), false);
  const e = a.estadoJson(); assert.equal(e.estado, "ok"); assert.equal(e.id, "0123456789abcdef"); assert.equal(e.codigo, 0);
  assert.match(readFileSync(join(a.env.PUBLICAR_ESTADO_DIR!, "publicar.log"), "utf8"), /implantando/);
  a.rodar(); assert.equal(a.chamadas(), 1); // o sinal vale uma vez
});

test("executor: deploy que falha registra 'falhou' com o código", () => {
  const a = ambiente(3);
  writeFileSync(a.pedido, '{"id":"aaaaaaaaaaaaaaaa"}\n'); a.rodar();
  const e = a.estadoJson(); assert.equal(e.estado, "falhou"); assert.equal(e.codigo, 3);
});

test("executor: recusa sinal sem id válido, grande demais, link simbólico ou velho; nada é executado", () => {
  const a = ambiente();
  for (const conteudo of ['{"id":"nao-hex"}', '{"comando":"rm -rf /"}', "x".repeat(3000) + '{"id":"0123456789abcdef"}']) {
    writeFileSync(a.pedido, conteudo); a.rodar();
    assert.equal(a.estadoJson().estado, "recusado", conteudo.slice(0, 30)); assert.equal(existsSync(a.pedido), false);
  }
  const alvo = join(a.raiz, "alvo"); writeFileSync(alvo, '{"id":"0123456789abcdef"}');
  symlinkSync(alvo, a.pedido); a.rodar();
  assert.equal(a.estadoJson().estado, "recusado"); assert.equal(existsSync(alvo), true); // o link some, o alvo fica
  writeFileSync(a.pedido, '{"id":"0123456789abcdef"}'); const velho = new Date(Date.now() - 3600_000); utimesSync(a.pedido, velho, velho); a.rodar();
  assert.equal(a.estadoJson().estado, "expirado");
  assert.equal(a.chamadas(), 0);
});

test("executor: o conteúdo do sinal nunca entra no estado (só o id validado)", () => {
  const a = ambiente();
  writeFileSync(a.pedido, '{"id":"0123456789abcdef","por":"x\\",\\"estado\\":\\"ok\\"; $(touch /tmp/pwn-publicar)"}\n'); a.rodar();
  assert.equal(existsSync("/tmp/pwn-publicar"), false);
  const bruto = readFileSync(join(a.env.PUBLICAR_ESTADO_DIR!, "publicar.estado"), "utf8"); assert.ok(!bruto.includes("pwn"));
});

test("site: pedir grava só o id e o autor; recusa pedido repetido, preview e instalação ausente", async () => {
  const P = await import("./publicar");
  const a = ambiente(); noEnv(a);
  const r = P.pedirPublicacao("dona@exemplo.org");
  assert.ok(r.ok && /^[a-f0-9]{16}$/.test((r as any).id));
  const conteudo = JSON.parse(readFileSync(a.pedido, "utf8")); assert.deepEqual(Object.keys(conteudo).sort(), ["em", "id", "por"]);
  assert.deepEqual(P.pedirPublicacao("dona@exemplo.org"), { ok: false, erro: "ja_pedido" });
  a.rodar(); // o executor consome e conclui
  assert.equal(P.situacaoPublicacao().ultimo?.estado, "ok"); assert.equal(P.situacaoPublicacao().emAndamento, false);
  assert.ok(P.pedirPublicacao("dona@exemplo.org").ok); // depois de concluir, pode pedir de novo
  process.env.PREVIEW_MODE = "1"; assert.deepEqual(P.pedirPublicacao("x"), { ok: false, erro: "preview" }); delete process.env.PREVIEW_MODE;
  process.env.PUBLICAR_ESTADO_DIR = join(a.raiz, "nao-existe"); assert.deepEqual(P.pedirPublicacao("x"), { ok: false, erro: "nao_instalado" });
});

test("site: publicação em andamento bloqueia novo pedido; estado velho de 'executando' não trava para sempre", async () => {
  const P = await import("./publicar");
  const a = ambiente(); noEnv(a);
  const f = join(a.env.PUBLICAR_ESTADO_DIR!, "publicar.estado");
  writeFileSync(f, JSON.stringify({ estado: "executando", id: "a".repeat(16), inicio: new Date().toISOString(), fim: "", codigo: null }));
  assert.deepEqual(P.pedirPublicacao("x"), { ok: false, erro: "em_andamento" });
  writeFileSync(f, JSON.stringify({ estado: "executando", id: "a".repeat(16), inicio: new Date(Date.now() - 3 * 3600_000).toISOString(), fim: "", codigo: null }));
  assert.ok(P.pedirPublicacao("x").ok);
});
