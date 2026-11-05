// Envia as respostas de contato JÁ APROVADAS pelo dono (as prévias estão em .cache/respostas/previas/).
// Uso: node /mnt/dev/peticao/tools/ponte/enviar-respostas.mjs 7 12      (números dos casos; só envia os que o dono aprovou)
// Cada resposta sai do MailerSend em nome da campanha, com Reply-To e cópia oculta para o dono, e é registrada em .cache/respostas/enviados.json (nunca envia 2 vezes).
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { enviar } from "./enviar.mjs";
const DIR = "/mnt/dev/peticao/.cache/respostas/";
const REG = DIR + "enviados.json";
const enviados = existsSync(REG) ? JSON.parse(readFileSync(REG, "utf8")) : {};
const idx = JSON.parse(readFileSync(DIR + "previas/indice.json", "utf8"));
const pedidos = process.argv.slice(2).map(Number).filter(Boolean);
if (!pedidos.length) { console.log("Informe os números dos casos aprovados. Exemplo: node enviar-respostas.mjs 7 12"); process.exit(1); }
for (const n of pedidos) {
  const c = idx.find((x) => x.n === n);
  if (!c) { console.log(`caso ${n}: não existe`); continue; }
  if (enviados[n]) { console.log(`caso ${n}: já enviado em ${enviados[n].em}; ignorado`); continue; }
  const html = readFileSync(`${DIR}previas/caso-${n}.html`, "utf8"), texto = readFileSync(`${DIR}previas/caso-${n}.txt`, "utf8");
  const r = await enviar({ assunto: c.assunto, html, texto, para: c.email, replyTo: "operator-1608598f41@example.invalid", bcc: "operator-1608598f41@example.invalid", deNome: "Campanha Sanção Integral · ADUNIR" });
  console.log(`caso ${n} → ${c.nome.split(" ")[0]} <${c.email}>:`, r.status, r.erro ?? "aceito pelo MailerSend");
  if (r.status && r.status < 300) { enviados[n] = { para: c.email, em: new Date().toISOString(), id: r.id }; writeFileSync(REG, JSON.stringify(enviados, null, 1)); }
}
