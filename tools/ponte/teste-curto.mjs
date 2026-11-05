import { enviar } from "./enviar.mjs"; import { cf, conta, kvId } from "./lib.mjs";
const marca = "t" + Date.now().toString(36);
console.log("envio:", JSON.stringify(await enviar({ assunto: `[ponte] ${marca}`, html: `<p>APROVADO ${marca}</p>`, texto: `APROVADO ${marca}`, para: "ponte@painel.sancionaintegral.org", replyTo: "x@exemplo.invalid", provedor: "mailersend" })));
const z = await conta(), acc = z.account.id, kv = await kvId(acc);
for (let i = 0; i < 9; i++) { await new Promise((r) => setTimeout(r, 10000)); const ks = (await cf(`/accounts/${acc}/storage/kv/namespaces/${kv}/keys?limit=50`)).result ?? []; console.log("chaves:", ks.map((k) => k.name).join(",") || "(nenhuma)"); if (ks.length) break; }
