// Persistent monitor: authenticated owner mail is queued locally; contact triage is read-only.
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { mensagens } from "./ler.mjs";
import { gravarAtomico, receberMensagens } from "./vigia-state.mjs";

process.umask(0o077);
const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const DIR = ROOT + ".cache/ponte";
const INTERVALO = Math.max(15, Number(process.env.VIGIA_INTERVALO_S) || 30) * 1000;
const TRIAGEM = Math.max(60, Number(process.env.VIGIA_TRIAGEM_S) || 300) * 1000;
mkdirSync(DIR, { recursive: true, mode: 0o700 });
let state = {};
try { state = JSON.parse(readFileSync(DIR + "/vigia-health.json", "utf8")); } catch { /* First start. */ }
const log = value => console.log(JSON.stringify(value));
let child = null;
function triagem() {
  if (process.env.VIGIA_SEM_TRIAGEM === "1" || child) return;
  child = spawn(process.execPath, [ROOT + "tools/ponte/triagem.mjs"], { stdio: ["ignore", "pipe", "pipe"], timeout: 180_000 });
  let output = "";
  child.stdout.on("data", chunk => { if (output.length < 32768) output += chunk; });
  child.stderr.resume();
  child.on("error", () => log({ triagem: "erro_de_execucao" }));
  child.on("close", code => {
    let result;
    try { result = JSON.parse(output.trim().split("\n").at(-1)); } catch { /* Retry next cycle. */ }
    const health = { ultimaRodada: new Date().toISOString(), ok: code === 0 && !!result && !result.erro, novos: result?.novos ?? null };
    gravarAtomico(DIR + "/vigia-triagem-health.json", health);
    log({ triagem: health.ok ? "concluida" : "erro", novos: health.novos });
    child = null;
  });
}
let stopping = false;
for (const signal of ["SIGTERM", "SIGINT"]) process.on(signal, () => { stopping = true; child?.kill(); process.exit(0); });
log({ vigia: "ligado", intervalo_s: INTERVALO / 1000, triagem: process.env.VIGIA_SEM_TRIAGEM !== "1" });
triagem();
const timer = setInterval(triagem, TRIAGEM);
while (!stopping) {
  try {
    state = receberMensagens(await mensagens(0), DIR, state, log);
  } catch (error) {
    state = { ...state, ultimaFalha: new Date().toISOString(), ultimoErro: error?.name || "Error" };
    gravarAtomico(DIR + "/vigia-health.json", state);
    log({ vigia: "falha_consulta", tipo: state.ultimoErro });
  }
  await new Promise(resolve => setTimeout(resolve, INTERVALO));
}
clearInterval(timer);
