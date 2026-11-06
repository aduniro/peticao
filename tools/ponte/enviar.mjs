// Envia um e-mail pela ponte. Uso: import { enviar } ... | node enviar.mjs "assunto" arquivo.html [--para x@y] [--reply]
import { getKey } from "/mnt/dev/peticao/tools/infra/lib/keystore.mjs";
import { ENDERECO, DONO } from "./lib.mjs";
export async function enviar({ assunto, html, texto, para = DONO, replyTo = ENDERECO, provedor = "mailersend", deNome = "Painel da petição (aprovações)", bcc }) {
  if (/adunir\.andes@gmail\.com/i.test(para) || /\.(gov|leg|jus)\.br$/i.test(para)) throw new Error("destinatário proibido");
  if (provedor === "mailersend") {
    const r = await fetch("https://api.mailersend.com/v1/email", { method: "POST", headers: { Authorization: "Bearer " + getKey("MAILERSEND_API_TOKEN"), "content-type": "application/json" }, body: JSON.stringify({ from: { email: "adunir@envia.sancionaintegral.org", name: deNome }, to: [{ email: para }], ...(bcc ? { bcc: [{ email: bcc }] } : {}), reply_to: { email: replyTo }, subject: assunto, html, text: texto }) });
    return { provedor, status: r.status, id: r.headers.get("x-message-id"), erro: r.ok ? null : (await r.text()).slice(0, 300) };
  }
  const t = await (await fetch("https://api.sendpulse.com/oauth/access_token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials", client_id: getKey("SENDPULSE_CLIENT_ID"), client_secret: getKey("SENDPULSE_CLIENT_SECRET") }) })).json();
  const r = await fetch("https://api.sendpulse.com/smtp/emails", { method: "POST", headers: { Authorization: "Bearer " + t.access_token, "content-type": "application/json" }, body: JSON.stringify({ email: { subject: assunto, from: { name: "Painel da petição (aprovações)", email: "adunir@sancionaintegral.org" }, to: [{ name: "ADUNIR", email: para }], reply_to: { email: replyTo, name: "Ponte" }, html: Buffer.from(html).toString("base64"), text: texto } }) });
  return { provedor, status: r.status, resposta: (await r.text()).slice(0, 200) };
}
