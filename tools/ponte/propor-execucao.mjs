import { propor } from "./aprovacao.mjs";
const r = await propor({
  tarefa: "EXECUTAR o reenvio da confirmação (1.153 pessoas)",
  resumo: "Esta é a proposta de EXECUÇÃO. O texto do e-mail já está aprovado (AP-98C8CC). Ao responder APROVAR, o reenvio começa sozinho, em lotes, e eu te aviso por e-mail ao terminar. Já está publicado em produção (inerte) e o rodízio entre serviços já está ligado.",
  detalhes: [
    "Quem recebe: 1.153 cadastros pendentes criados em 04/11 entre 04h e 12h (979 servidores, 173 apoiadores, 1 estrangeiro). Fora: quem já confirmou, 1 e-mail na lista de supressão e quem já recebeu este reenvio (o sistema grava cada envio e nunca repete).",
    "Como: lotes de 60 a cada ~2 minutos (cerca de 40 minutos no total), pelo rodízio entre SES (60%), SendPulse (30%) e MailerSend (10%). Sempre um serviço DIFERENTE do que já enviou à pessoa; essas pessoas não receberam nada do serviço anterior, então vale o rodízio normal. Remetente: o mesmo da confirmação original (confirmar@assinatura.sancionaintegral.org no SES).",
    "Cada pessoa ganha um NOVO link de 48 h. A data e a hora originais do cadastro ficam intactas. Limite de um reenvio por cadastro.",
    "Segurança: pausa sozinho após 8 falhas seguidas; o disjuntor tira um serviço do rodízio se ele falhar 3 vezes; eu acompanho e te aviso por e-mail ao terminar, com o resumo (enviados, falhas, por serviço).",
    "Prazo: os links atuais vencem entre 06/11 04h29 e 11h58, então há folga; mas quanto antes, melhor.",
    "Parar a qualquer momento: responda CANCELAR a este e-mail ou me peça por aqui; basta eu limpar a chave de ativação.",
    "Rastreio: o que for entregue/aberto/clicado pelos serviços com webhook (Brevo e MailerSend) já passa a ser registrado; o SES precisa de um ajuste de administrador AWS que está documentado nas pendências.",
  ],
});
console.log(JSON.stringify(r));
