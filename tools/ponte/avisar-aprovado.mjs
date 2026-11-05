import { enviar } from "./enviar.mjs";
const html = `<div style="font-family:system-ui,sans-serif;max-width:640px;line-height:1.5"><h2>✅ Modelo de reenvio APROVADO (AP-98C8CC)</h2>
<p>Recebi o seu <b>"APROVAR"</b> (do seu Proton, DKIM válido, na conversa da proposta). Registrado: o <b>texto</b> do e-mail de reenvio está aprovado. Ainda <b>não disparei nada</b>.</p>
<h3>O que vem agora, na ordem</h3><ol>
<li><b>Agora:</b> publico as políticas centrais (rodízio entre serviços de e-mail, reenvio travado por aprovação, rastreio de entrega/abertura/clique, checagem de e-mail em rodízio). O job de reenvio entra <b>inerte</b>: só funciona com uma chave que eu só ligo depois da sua aprovação da execução.</li>
<li><b>Em seguida:</b> envio uma <b>nova proposta (código novo)</b> só para a EXECUÇÃO: quantas pessoas, janela, serviços, ritmo e hora. Você responde APROVAR e então o disparo começa, em lotes, por um serviço diferente do que enviou antes.</li>
<li>Depois: o redesenho do painel (dashboard e mapas) no preview, sem publicar sem você ver.</li></ol></div>`;
console.log(JSON.stringify(await enviar({ assunto: "Re: [AP-98C8CC] Modelo APROVADO — próximos passos (nada disparado ainda)", html, texto: "Modelo de reenvio APROVADO (AP-98C8CC). Nada foi disparado. Agora: publico as politicas centrais (job de reenvio inerte); depois envio nova proposta so para a EXECUCAO; voce responde APROVAR e o disparo comeca.", provedor: "sendpulse" })));
