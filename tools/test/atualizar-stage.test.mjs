import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const SCRIPT = new URL("../../deploy/peticao-atualizar-stage.sh", import.meta.url).pathname;
const git = (cwd, ...a) => execFileSync("git", a, { cwd, encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@t" } }).trim();

test("atualizador do stage: grava VERSAO e MUDANCAS (o que entrou desde a versão anterior) e preserva o que está fora do git", () => {
  const raiz = mkdtempSync(join(tmpdir(), "stage-")), bare = join(raiz, "bare.git"), work = join(raiz, "work"), checkout = join(raiz, "checkout"), stage = join(raiz, "stage");
  git(raiz, "init", "-q", "--bare", "--initial-branch=producao", bare);
  git(raiz, "clone", "-q", bare, work); git(work, "checkout", "-q", "-B", "producao");
  mkdirSync(join(work, "site")); mkdirSync(join(work, "deploy")); writeFileSync(join(work, "site", "a.txt"), "1"); writeFileSync(join(work, "deploy", "d.sh"), "#");
  git(work, "add", "-A"); git(work, "commit", "-q", "-m", "Primeira versão"); git(work, "push", "-q", "origin", "producao");
  mkdirSync(join(stage, "site", "geo-data"), { recursive: true }); writeFileSync(join(stage, "site", "geo-data", "base.bin"), "grande"); writeFileSync(join(stage, "site", ".env.local"), "SEGREDO=1");
  const rodar = () => { const r = spawnSync("bash", [SCRIPT], { encoding: "utf8", env: { ...process.env, BARE: bare, CHECKOUT: checkout, STAGE: stage, HOME_DIR: raiz, DEPLOY_USER: "teste" } }); assert.equal(r.status, 0, r.stderr + r.stdout); return r.stdout; };
  rodar();
  const v1 = readFileSync(join(stage, "VERSAO"), "utf8").trim();
  assert.equal(readFileSync(join(stage, "site", "VERSAO"), "utf8").trim(), v1);
  assert.match(readFileSync(join(stage, "site", "MUDANCAS"), "utf8"), /Primeira versão/); // sem versão anterior: as últimas alterações
  writeFileSync(join(work, "site", "b.txt"), "2"); git(work, "add", "-A"); git(work, "commit", "-q", "-m", "Segunda: adiciona b"); writeFileSync(join(work, "site", "c.txt"), "3"); git(work, "add", "-A"); git(work, "commit", "-q", "-m", "Terceira: adiciona c"); git(work, "push", "-q", "origin", "producao");
  rodar();
  const m = readFileSync(join(stage, "site", "MUDANCAS"), "utf8").trim().split("\n");
  assert.equal(m.length, 2); assert.match(m[0], /Terceira: adiciona c/); assert.match(m[1], /Segunda: adiciona b/); assert.ok(!m.join("\n").includes("Primeira")); // só o que entrou desde a versão anterior
  assert.notEqual(readFileSync(join(stage, "VERSAO"), "utf8").trim(), v1);
  assert.ok(existsSync(join(stage, "site", "b.txt")) && existsSync(join(stage, "site", "c.txt")));
  assert.equal(readFileSync(join(stage, "site", "geo-data", "base.bin"), "utf8"), "grande"); // fora do git: intocado
  assert.equal(readFileSync(join(stage, "site", ".env.local"), "utf8"), "SEGREDO=1");
});
