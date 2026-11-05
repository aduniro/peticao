// Worker de e-mail da "ponte": recebe as mensagens de ponte@painel.sancionaintegral.org e guarda no KV (30 dias).
// Nada é encaminhado nem respondido por aqui; a leitura é feita por tools/ponte/ler.mjs.
export default {
  async email(message, env) {
    const id = `m:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    const ttl = { expirationTtl: 60 * 60 * 24 * 30 };
    try {
      let raw = "";
      try { raw = await new Response(message.raw).text(); } catch (e) { raw = "ERRO_LEITURA_RAW: " + String(e); }
      const h = (n) => { try { return message.headers.get(n) ?? ""; } catch { return ""; } };
      await env.CAIXA.put(id, JSON.stringify({
        id, recebido: new Date().toISOString(), de: message.from, para: message.to, tamanho: message.rawSize,
        assunto: h("subject"), replyTo: h("reply-to"), auth: h("authentication-results"), dkim: h("dkim-signature").slice(0, 200), inReplyTo: h("in-reply-to"),
        raw: raw.slice(0, 80000),
      }), ttl);
    } catch (e) {
      try { await env.CAIXA.put("e:" + id, String(e && e.stack || e).slice(0, 500), ttl); } catch {}
    }
  },
};
