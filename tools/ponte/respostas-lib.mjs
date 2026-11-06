// Respostas de contato aprovadas: cada caso sai em DOIS e-mails, nesta ordem: (1) só texto, no primeiro modelo que o dono recebeu, e (2) o e-mail com o card
// de divulgação (cartaz com o QR pessoal). Funções puras e com injeção de dependências, para testar sem enviar nada.
import { readFileSync } from "node:fs";
export const DIR = "/mnt/dev/peticao/.cache/respostas/";
export const ASSUNTO_CARD = "Divulgue a petição: seu cartaz com QR Code pessoal";
export const REPLY_TO = "operator-1608598f41@example.invalid";
export const REMETENTE = "Campanha Sanção Integral · ADUNIR";
const json = (p) => JSON.parse(readFileSync(p, "utf8"));

/** Os dois e-mails de um caso. O primeiro NÃO tem HTML (só texto). */
export function mensagensDoCaso(n, dir = DIR) {
  const idx = json(dir + "previas/indice.json").find((x) => x.n === n);
  const modelo = json(dir + "primeiro-modelo.json")[n];
  if (!idx || !modelo) throw new Error(`caso ${n} desconhecido`);
  return {
    para: idx.email, nome: idx.nome,
    mensagens: [
      { versao: "texto", assunto: modelo.assunto, texto: modelo.texto },
      { versao: "card", assunto: ASSUNTO_CARD, html: readFileSync(`${dir}previas/caso-${n}.html`, "utf8"), texto: readFileSync(`${dir}previas/caso-${n}.txt`, "utf8") },
    ],
  };
}

const dormir = (ms) => new Promise((r) => setTimeout(r, ms));
/**
 * Envia os dois e-mails do caso (a menos que já tenham saído: `registro` por caso e por versão). Se um envio falhar, para ali e não registra.
 * `enviar` = função de envio; `salvar(registro)` grava o registro; `esperar(ms)` dá o intervalo entre os dois e-mails do mesmo caso.
 */
export async function enviarCaso(n, { dir = DIR, enviar, registro, salvar, esperar = dormir, intervaloMs = 60_000, log = console.log }) {
  const { para, nome, mensagens } = mensagensDoCaso(n, dir);
  registro[n] ??= {};
  let enviouAgora = false;
  for (const m of mensagens) {
    const ja = registro[n][m.versao];
    if (ja) { log(`caso ${n} (${m.versao}): já enviado em ${ja.em}; ignorado`); continue; }
    if (enviouAgora) await esperar(intervaloMs);
    const r = await enviar({ assunto: m.assunto, html: m.html, texto: m.texto, para, replyTo: REPLY_TO, bcc: REPLY_TO, deNome: REMETENTE });
    const ok = !!r.status && r.status < 300;
    log(`caso ${n} (${m.versao === "texto" ? "só texto" : "com card"}) → ${nome.split(" ")[0]} <${para}>:`, r.status, ok ? "aceito pelo MailerSend" : (r.erro ?? "falhou"));
    if (!ok) return { ok: false, versao: m.versao };
    registro[n][m.versao] = { para, em: new Date().toISOString(), id: r.id ?? null };
    salvar(registro);
    enviouAgora = true;
  }
  return { ok: true };
}
