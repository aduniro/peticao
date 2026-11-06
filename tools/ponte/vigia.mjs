// Vigia da campanha. Faz DUAS coisas, e as duas retomam de onde pararam toda vez que ele é ligado (nada do que chegou com ele desligado se perde):
//  1) Caixa da ponte (ponte@painel.sancionaintegral.org): imprime UMA linha JSON para cada e-mail NOVO enviado pelo dono, para a sessão do Claude reagir.
//     Só passam e-mails do dono (os endereços de dono.mjs) com DKIM aprovado do MESMO domínio do remetente. O estado (o que já foi visto) fica em .cache/ponte/vigia.json.
//  2) Mensagens de contato dos usuários (banco do servidor, SOMENTE LEITURA): ao ligar e a cada 5 minutos procura as que ainda não foram vistas, investiga
//     (cadastro, e-mails enviados, devoluções, fila, logs do app), decide se o relato procede e manda ao dono UM e-mail de relatório com proposta de
//     resolução e de resposta (triagem.mjs; estado em .cache/ponte/triagem.json). Nunca escreve no servidor nem escreve à pessoa que reclamou.
// Uso: node /mnt/dev/peticao/tools/ponte/vigia.mjs        (fica rodando; ponte a cada 60 s, triagem a cada 5 min; VIGIA_SEM_TRIAGEM=1 desliga a parte 2)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mensagens, corpoNovo } from "./ler.mjs";
import { doDono } from "./dono.mjs";
import { triagemUmaVez } from "./triagem.mjs";

const RAIZ = fileURLToPath(new URL("../../", import.meta.url));
const ESTADO = RAIZ + ".cache/ponte/vigia.json";
const INTERVALO = Number(process.env.VIGIA_INTERVALO_S ?? 60) * 1000;
const TRIAGEM_S = Number(process.env.VIGIA_TRIAGEM_S ?? 300) * 1000;
const COM_TRIAGEM = process.env.VIGIA_SEM_TRIAGEM !== "1";

const ler = () => { try { return JSON.parse(readFileSync(ESTADO, "utf8")); } catch { return null; } };
const gravar = (e) => { mkdirSync(dirname(ESTADO), { recursive: true }); writeFileSync(ESTADO, JSON.stringify(e)); };

let estado = ler() ?? { ate: new Date().toISOString(), vistos: [] }; // primeira execução: só o que chegar daqui para a frente
gravar(estado);
console.log(JSON.stringify({ vigia: "ligado", desde: estado.ate, intervalo_s: INTERVALO / 1000, triagem: COM_TRIAGEM }));

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

// Triagem: roda ao ligar (pega o que ficou sem ver) e depois a cada TRIAGEM_S. Falha de acesso ao servidor é avisada uma vez e tentada de novo na rodada seguinte.
let proximaTriagem = 0, triagemComErro = false;
async function triagem() {
  if (!COM_TRIAGEM || Date.now() < proximaTriagem) return;
  proximaTriagem = Date.now() + TRIAGEM_S;
  const r = await triagemUmaVez();
  if (r.erro) { if (!triagemComErro) console.log(JSON.stringify({ triagem: "erro", detalhe: r.erro })); triagemComErro = true; return; }
  if (triagemComErro) console.log(JSON.stringify({ triagem: "voltou" }));
  triagemComErro = false;
  if (r.novos) console.log(JSON.stringify({ triagem: "relatorio_enviado_ao_dono", mensagens: r.ids, vereditos: r.vereditos }));
}

let falhas = 0;
for (;;) {
  try { await volta(); falhas = 0; } catch (e) { if (++falhas === 5) console.log(JSON.stringify({ vigia: "erro", detalhe: String(e).slice(0, 160) })); }
  try { await triagem(); } catch (e) { console.log(JSON.stringify({ triagem: "erro", detalhe: String(e).slice(0, 160) })); }
  await new Promise((r) => setTimeout(r, INTERVALO));
}
