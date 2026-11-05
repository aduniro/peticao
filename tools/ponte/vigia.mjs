// Vigia da caixa da ponte (ponte@painel.sancionaintegral.org): imprime UMA linha JSON para cada e-mail NOVO enviado pelo dono, para a sessão do Claude reagir.
// Uso: node /mnt/dev/peticao/tools/ponte/vigia.mjs        (fica rodando; consulta a caixa a cada 60 s)
// Só passam e-mails do dono (os 3 endereços de dono.mjs) com DKIM aprovado do MESMO domínio do endereço do remetente.
// Bounces, avisos do SendPulse e qualquer outro remetente são ignorados. O estado (o que já foi visto) fica em .cache/ponte/vigia.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mensagens, corpoNovo } from "./ler.mjs";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const ESTADO = RAIZ + ".cache/ponte/vigia.json";
const INTERVALO = Number(process.env.VIGIA_INTERVALO_S ?? 60) * 1000;
import { doDono } from "./dono.mjs";

const ler = () => { try { return JSON.parse(readFileSync(ESTADO, "utf8")); } catch { return null; } };
const gravar = (e) => { mkdirSync(dirname(ESTADO), { recursive: true }); writeFileSync(ESTADO, JSON.stringify(e)); };

let estado = ler() ?? { ate: new Date().toISOString(), vistos: [] }; // primeira execução: só o que chegar daqui para a frente
gravar(estado);
console.log(JSON.stringify({ vigia: "ligado", desde: estado.ate, intervalo_s: INTERVALO / 1000 }));

async function volta() {
  const L = (await mensagens(0)).filter((m) => m.recebido > estado.ate && !estado.vistos.includes(m.recebido));
  for (const m of L.sort((a, b) => a.recebido.localeCompare(b.recebido))) {
    estado.vistos = [...estado.vistos, m.recebido].slice(-500);
    if (m.recebido > estado.ate) estado.ate = m.recebido;
    if (!doDono(m)) continue;
    console.log(JSON.stringify({ email_do_dono: true, recebido: m.recebido, de: m.de, assunto: m.assunto, corpo: corpoNovo(m.raw).slice(0, 4000) }));
  }
  gravar(estado);
}
let falhas = 0;
for (;;) {
  try { await volta(); falhas = 0; } catch (e) { if (++falhas === 5) console.log(JSON.stringify({ vigia: "erro", detalhe: String(e).slice(0, 160) })); }
  await new Promise((r) => setTimeout(r, INTERVALO));
}
