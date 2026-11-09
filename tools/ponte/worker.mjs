// Worker de e-mail da "ponte": recebe as mensagens de ponte@docentes.magisteriofederal.org e guarda no KV (30 dias).
// Nada é encaminhado nem respondido por aqui; a leitura é feita por tools/ponte/ler.mjs.
export default {
  async email(message, env) {
    const raw = await new Response(message.raw).text();
    const h = (n) => message.headers.get(n) ?? "";
    const id = `m:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    await env.CAIXA.put(id, JSON.stringify({
      id, recebido: new Date().toISOString(), de: message.from, para: message.to, tamanho: message.rawSize,
      assunto: h("subject"), replyTo: h("reply-to"), auth: h("authentication-results"), dkim: h("dkim-signature").slice(0, 200), inReplyTo: h("in-reply-to"),
      raw: raw.slice(0, 80000),
    }), { expirationTtl: 60 * 60 * 24 * 30 });
  },
};
