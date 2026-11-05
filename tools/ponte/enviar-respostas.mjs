// Envia as respostas de contato JÁ APROVADAS pelo dono. Cada caso sai em DOIS e-mails: (1) só texto (primeiro modelo) e (2) com o card de divulgação.
// Uso: node /mnt/dev/peticao/tools/ponte/enviar-respostas.mjs 7 9 12 [--intervalo=60]   (números dos casos; só os que o dono aprovou)
//   --intervalo=<s>: segundos entre os dois e-mails do mesmo caso (padrão 60; entre um caso e outro esperam-se 20 s).
// Remetente "Campanha Sanção Integral · ADUNIR" (MailerSend), Reply-To e cópia oculta para o dono; registro em .cache/respostas/enviados.json: nunca envia 2 vezes.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { enviar } from "./enviar.mjs";
import { DIR, enviarCaso } from "./respostas-lib.mjs";

const args = process.argv.slice(2);
if (args.includes("--leve")) { console.log("A opção --leve foi removida: a versão simples é o e-mail só de texto (primeiro modelo), enviado automaticamente junto com o e-mail do card."); process.exit(1); }
const pedidos = args.filter((a) => /^\d+$/.test(a)).map(Number);
if (!pedidos.length) { console.log("Informe os números dos casos aprovados. Exemplo: node /mnt/dev/peticao/tools/ponte/enviar-respostas.mjs 7 9 12"); process.exit(1); }
const intervalo = Number((args.find((a) => a.startsWith("--intervalo=")) ?? "").split("=")[1] ?? 60) * 1000;
const REG = DIR + "enviados.json";
const registro = existsSync(REG) ? JSON.parse(readFileSync(REG, "utf8")) : {};
const salvar = (r) => writeFileSync(REG, JSON.stringify(r, null, 1));
for (const [i, n] of pedidos.entries()) {
  if (i > 0) await new Promise((r) => setTimeout(r, 20_000));
  try { const res = await enviarCaso(n, { enviar, registro, salvar, intervaloMs: intervalo }); if (!res.ok) console.log(`caso ${n}: parado; confira o erro acima e rode de novo (o que já saiu não é reenviado).`); }
  catch (e) { console.log(`caso ${n}: ${e.message}`); }
}
