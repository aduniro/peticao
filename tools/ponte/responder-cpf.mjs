import { enviar } from "./enviar.mjs";
const html = `<div style="font-family:system-ui,sans-serif;max-width:640px;line-height:1.5"><p>Re: <b>[AP-98C8CC]</b> — sua pergunta: <i>"as pessoas que se cadastraram nesse intervalo tiveram o CPF verificado pela API do CPF-Brasil?"</i></p>
<h3>Resposta: sim</h3>
<p>Janela de <b>04/11, 04h–12h</b> (Brasília): <b>1.169 cadastros</b>. Para todos os brasileiros (1.168) o <b>nome foi conferido com a base do CPF na hora do cadastro, com resultado "confere"</b>:</p>
<ul><li><b>992 servidores</b>: e-mail institucional + nome conferido com o CPF.</li>
<li><b>173 apoiadores</b>: nome conferido <u>e</u> segunda camada de identidade — 143 por data de nascimento e 30 pelo nome da mãe (a mais 3 apoiadores com e-mail institucional).</li>
<li>1 estrangeiro (sem CPF; validação por universidade).</li></ul>
<p>Ou seja, os dados dessas pessoas são válidos. O que falhou foi <b>só o envio do e-mail de confirmação</b> (a Brevo parou de enviar por volta das 05h e o SES só entrou ao redor das 12h). Elas estão pendentes, com o link ainda válido até 06/11 (a partir das 00h13).</p>
<p><b>Observação:</b> o serviço de CPF registrou um erro de rede intermitente às 23h51 de ontem; vou acompanhar se isso volta a ocorrer.</p>
<div style="background:#fff8d6;border:2px solid #f2c200;border-radius:10px;padding:14px;margin:16px 0"><b>A proposta AP-98C8CC continua aguardando você.</b> Responda na primeira linha: <b>APROVADO</b>, <b>MODIFICAR:</b> e o pedido, ou <b>CANCELAR</b> (aprovar este modelo não dispara nada; o disparo terá uma proposta própria).</div></div>`;
console.log(JSON.stringify(await enviar({ assunto: "Re: [AP-98C8CC] Modelo do e-mail de reenvio — resposta sobre a verificação do CPF", html, texto: "Resposta: sim. Na janela de 04/11 04h-12h houve 1.169 cadastros; para os 1.168 brasileiros o nome foi conferido com a base do CPF (resultado: confere); apoiadores tambem tiveram nascimento ou nome da mae; servidores, e-mail institucional. Falhou apenas o envio do e-mail de confirmacao. A proposta AP-98C8CC continua aguardando: responda APROVADO, MODIFICAR: ... ou CANCELAR na primeira linha.", provedor: "sendpulse" })));
