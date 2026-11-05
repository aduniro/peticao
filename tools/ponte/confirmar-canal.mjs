import { enviar } from "./enviar.mjs";
const html = `<div style="font-family:system-ui,sans-serif;max-width:620px;line-height:1.5"><h2>Canal por e-mail funcionando ✅</h2>
<p>Recebi a sua resposta (<i>"eu recebi o seu email…"</i>) no endereço da ponte, <b>vinda do seu Proton, com a assinatura DKIM válida</b>. Isto confirma o caminho de ida e volta.</p>
<h3>Como funciona daqui para frente</h3><ul>
<li>Toda tarefa que afete o público (reenvio, publicação, envio em lote…) chega primeiro para você como uma <b>proposta com código</b> (ex.: AP-1A2B3C), com o modelo para revisão.</li>
<li>Você responde na <b>primeira linha</b>: <b>APROVADO</b>, <b>MODIFICAR:</b> e o pedido, ou <b>CANCELAR</b>.</li>
<li>Só executo depois do <b>APROVADO</b> com o código certo, vindo do seu e-mail com DKIM válido (outra pessoa não consegue aprovar).</li>
<li>Se pedir modificações, mando uma <b>nova proposta</b> (novo código) para você aprovar de novo.</li></ul>
<p>Estou preparando agora a <b>proposta do e-mail de reenvio</b> para as ~1.157 pessoas que não receberam a confirmação.</p></div>`;
console.log(JSON.stringify(await enviar({ assunto: "[ponte] Canal por e-mail OK — como aprovar tarefas", html, texto: "Canal por e-mail funcionando. Recebi sua resposta vinda do Proton com DKIM válido. Daqui para frente, cada tarefa que afeta o público chega como proposta com código; responda APROVADO, MODIFICAR: ... ou CANCELAR na primeira linha. Só executo após APROVADO com o código certo.", provedor: "sendpulse" })));
