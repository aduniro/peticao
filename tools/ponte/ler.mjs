// Lê as mensagens recebidas pela ponte (KV). Uso: node ler.mjs [--desde ISO] [--json]
import { cf, conta, kvId } from "./lib.mjs";
export async function mensagens(desde = 0) {
  const z = await conta(); const acc = z.account.id; const kv = await kvId(acc);
  const ks = (await cf(`/accounts/${acc}/storage/kv/namespaces/${kv}/keys?limit=1000&prefix=m:`)).result ?? [];
  const out = [];
  for (const k of ks) { const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${acc}/storage/kv/namespaces/${kv}/values/${encodeURIComponent(k.name)}`, { headers: { Authorization: "Bearer " + (await import("/mnt/dev/peticao/tools/infra/lib/keystore.mjs")).getKey("CLOUDFLARE_API_TOKEN") } }); try { const m = JSON.parse(await r.text()); if (new Date(m.recebido).getTime() >= desde) out.push(m); } catch {} }
  return out.sort((a, b) => a.recebido.localeCompare(b.recebido));
}
// Texto novo da resposta, sem a citação da mensagem anterior.
export function corpoNovo(raw) {
  let t = String(raw).split(/\r?\n\r?\n/).slice(1).join("\n\n");
  if (/content-transfer-encoding:\s*base64/i.test(raw) && !/--/.test(t.slice(0, 40))) { try { t = Buffer.from(t.replace(/\s+/g, ""), "base64").toString("utf8"); } catch {} }
  const mp = /boundary="?([^"\r\n;]+)"?/i.exec(raw);
  if (mp) { const partes = String(raw).split("--" + mp[1]); const txt = partes.find((p) => /content-type:\s*text\/plain/i.test(p)); if (txt) { let b = txt.split(/\r?\n\r?\n/).slice(1).join("\n\n"); if (/content-transfer-encoding:\s*base64/i.test(txt)) b = Buffer.from(b.replace(/\s+/g, ""), "base64").toString("utf8"); else if (/quoted-printable/i.test(txt)) b = b.replace(/=\r?\n/g, "").replace(/=([0-9A-F]{2})/gi, (_, h) => String.fromCharCode(parseInt(h, 16))); t = b; } }
  const linhas = t.split(/\r?\n/); const novo = [];
  for (const l of linhas) { if (/^>/.test(l) || /^(On|Em) .{5,120}(wrote|escreveu):?\s*$/i.test(l.trim()) || /^-{2,}\s*(Original|Mensagem original|Forwarded)/i.test(l.trim()) || /^(De|From):\s.+@/.test(l.trim())) break; novo.push(l); }
  return novo.join("\n").trim();
}
if (process.argv[1]?.endsWith("ler.mjs")) {
  const i = process.argv.indexOf("--desde"); const desde = i > 0 ? new Date(process.argv[i + 1]).getTime() : 0;
  const L = await mensagens(desde);
  if (process.argv.includes("--json")) console.log(JSON.stringify(L.map((m) => ({ ...m, raw: undefined, corpo: corpoNovo(m.raw) })), null, 1));
  else for (const m of L) console.log(m.recebido, "|", m.de, "→", m.para, "|", m.assunto, "| auth:", /dkim=pass/i.test(m.auth) ? "dkim ok" : (m.auth ? "dkim ?" : "sem info"), "\n   corpo:", corpoNovo(m.raw).slice(0, 200).replace(/\n/g, " ⏎ "));
  if (!L.length) console.log("(nenhuma mensagem)");
}
