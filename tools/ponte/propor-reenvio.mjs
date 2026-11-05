import { readFileSync } from "node:fs"; import { propor } from "./aprovacao.mjs";
const html = readFileSync("/mnt/dev/peticao/.cache/ponte/amostra-reenvio.html", "utf8"); const txt = readFileSync("/mnt/dev/peticao/.cache/ponte/amostra-reenvio.txt", "utf8");
const r = await propor({
  tarefa: "Modelo do e-mail de reenvio (assinaturas que não receberam a confirmação)",
  resumo: "Aprove (ou peça ajustes) o TEXTO do e-mail de reenvio. Aprovar este modelo NÃO dispara nada: o disparo só ocorre depois, com a sua aprovação de uma proposta separada de execução.",
  detalhes: [
    "Quem receberia: ~1.157 pessoas que se cadastraram em 04/11 entre 04h e 12h (horário de Brasília) e continuam pendentes; os links delas vencem a partir de 06/11 00h13. Seriam excluídas as que já confirmaram, as que têm e-mail na lista de supressão e as que já receberam este reenvio.",
    "Conteúdo: aviso de que houve problema no serviço de disparo (já corrigido), que alguns e-mails podem ter caído no spam, apelo para avisar os colegas a olharem o spam, e em seguida a solicitação padrão de assinatura com NOVO link (48 h). A data e a hora originais do cadastro ficam intactas.",
    "Envio: pelo rodízio entre serviços, sempre por um serviço diferente do que enviou antes (neste caso, as pessoas da janela não receberam nada do serviço anterior, então o rodízio vale entre SES, SendPulse e MailerSend; a Brevo está sem crédito).",
    "Ritmo: em lotes pequenos, com pausa automática se os bounces passarem de 2%.",
    "Assunto: " + txt.split("\n")[0].replace("ASSUNTO: ", ""),
  ],
  anexoHtml: html,
});
console.log(JSON.stringify(r));
