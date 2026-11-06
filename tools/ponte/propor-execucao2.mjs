import { propor } from "./aprovacao.mjs";
const r = await propor({
  tarefa: "REVISADA: reenvio (1.153 pessoas) pelo MailerSend, que vira o serviço padrão de envio",
  resumo: "Você pediu: enviar esses e-mails pelo único serviço com webhook de entrega, abertura e clique, e deixá-lo como padrão de envio agora. Entendi como MailerSend: é o único com webhook ativo que consegue enviar hoje (a Brevo também tem webhook, mas está com crédito zero; SES e SendPulse não têm webhook). Se você quis dizer a Brevo, responda MODIFICAR: Brevo (aí precisa recarregar crédito). Nada será executado antes do seu APROVAR.",
  detalhes: [
    "O que muda: (1) o reenvio dos 1.153 vai 100% pelo MailerSend, em lotes de 60 a cada ~2 min (cerca de 40 min); (2) o MailerSend passa a ser o PADRÃO de envio de todos os e-mails transacionais (confirmação, agradecimento, avisos), com SES, SendPulse e Brevo só como reserva automática se ele falhar.",
    "Rastreio: webhook do MailerSend já criado e ativo (enviado, entregue, aberto, clicado, devolvido, reclamação, descadastro) e rastreio de abertura/clique ligado no domínio; tudo cai no painel de e-mails.",
    "Remetente visível muda: sairá de assinatura@envia.sancionaintegral.org (em vez de confirmar@assinatura.). Resposta continua indo para adunir@sancionaintegral.org.",
    "RISCO 1 (reputação): o domínio envia. é novo (6 e-mails em 30 dias, sem histórico). Despejar volume alto de uma vez num domínio sem aquecimento é o que mais manda para o spam. O ritmo do reenvio (30 por minuto) é moderado, mas todo o tráfego novo também passaria a sair por ele. Recomendação: manter uma pequena fração no SES até o envia. ganhar histórico; se preferir, posso deixar MailerSend 80% e SES 20%.",
    "RISCO 2 (limite do plano): a API do MailerSend não mostra o limite de e-mails do plano (o limite de requisições é 60 por minuto). Começo com o primeiro lote de 60 e verifico; se falhar, o failover automático manda pelos outros e eu aviso.",
    "O texto do e-mail é o já aprovado (AP-98C8CC). Datas originais, um reenvio por cadastro, pausa após 8 falhas seguidas e novo link de 48 h continuam valendo.",
    "Como responder: APROVAR (como está), MODIFICAR: <ex.: MailerSend 80% e SES 20%> ou CANCELAR.",
  ],
});
console.log(JSON.stringify(r));
