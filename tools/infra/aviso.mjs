#!/usr/bin/env node
// Aviso de andamento por e-mail (SendPulse SMTP, remetente já ativo). Nunca envia para adunir.andes@gmail.com nem para .gov.br.
// Uso: node tools/infra/aviso.mjs "Assunto" "feito1|feito2" "falta1|falta2" ["observação"]
import { getKey } from "./lib/keystore.mjs";
const [assunto, feitos = "", faltam = "", obs = ""] = process.argv.slice(2);
const PARA = process.env.AVISO_PARA ?? "operator-1608598f41@example.invalid";
if (!assunto || /adunir\.andes@gmail\.com/i.test(PARA) || /\.(gov|leg|jus)\.br$/i.test(PARA)) { console.error("Assunto ausente ou destinatário proibido."); process.exit(1); }
const li = (s) => s.split("|").map((x) => x.trim()).filter(Boolean);
const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const lista = (t, a, v) => (a.length ? `<h3>${t}</h3><ul>${a.map((x) => `<li>${v} ${esc(x)}</li>`).join("")}</ul>` : "");
const f = li(feitos), p = li(faltam);
const html = `<div style="font-family:system-ui,sans-serif;max-width:560px"><h2>${esc(assunto)}</h2>${lista("Concluído", f, "✅")}${lista("Ainda falta", p, "⏳")}${obs ? `<p>${esc(obs)}</p>` : ""}<p style="color:#667">Aviso automático do andamento do app (nada foi publicado sem a sua autorização).</p></div>`;
const texto = `${assunto}\n\nConcluído:\n${f.map((x) => "- " + x).join("\n")}\n\nAinda falta:\n${p.map((x) => "- " + x).join("\n")}\n${obs ? "\n" + obs : ""}`;
const t = await (await fetch("https://api.sendpulse.com/oauth/access_token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "client_credentials", client_id: getKey("SENDPULSE_CLIENT_ID"), client_secret: getKey("SENDPULSE_CLIENT_SECRET") }) })).json();
const r = await fetch("https://api.sendpulse.com/smtp/emails", { method: "POST", headers: { Authorization: "Bearer " + t.access_token, "content-type": "application/json" }, body: JSON.stringify({ email: { subject: "[Petição] " + assunto, from: { name: "Andamento do app", email: "adunir@sancionaintegral.org" }, to: [{ name: "ADUNIR", email: PARA }], html: Buffer.from(html).toString("base64"), text: texto } }) });
console.log("aviso:", r.status, (await r.text()).slice(0, 120));
