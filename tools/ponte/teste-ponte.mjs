import { enviar } from "./enviar.mjs"; import { mensagens, corpoNovo } from "./ler.mjs"; import { ENDERECO } from "./lib.mjs";
const marca = "teste-" + Date.now().toString(36);
const t0 = Date.now() - 1000;
for (const provedor of ["sendpulse", "mailersend"]) {
  const r = await enviar({ assunto: `[ponte] ${marca} via ${provedor}`, html: `<p>Teste da ponte: <b>APROVADO</b> ${marca}</p><blockquote>citação</blockquote>`, texto: `APROVADO ${marca}\n\n> citação`, para: ENDERECO, replyTo: "resposta-teste@exemplo.invalid", provedor });
  console.log("envio", provedor, JSON.stringify(r));
}
for (let i = 0; i < 12; i++) {
  await new Promise((x) => setTimeout(x, 10000));
  const L = (await mensagens(t0)).filter((m) => m.assunto.includes(marca));
  if (L.length >= 2) { for (const m of L) console.log("RECEBIDO:", m.assunto, "| de:", m.de, "| reply-to:", m.replyTo, "| corpo:", JSON.stringify(corpoNovo(m.raw).slice(0, 60)), "| dkim:", /dkim=pass/i.test(m.auth)); process.exit(0); }
  console.log("aguardando…", L.length);
}
console.log("não chegou em 2 min"); process.exit(1);
