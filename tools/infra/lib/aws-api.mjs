// Cliente mínimo da AWS (assinatura SigV4, sem dependências). Chaves só em memória; nunca impressas.
import { createHash, createHmac } from "node:crypto";

const sha = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

/** Devolve o cabeçalho Authorization (e os cabeçalhos assinados) de uma requisição. */
export function signV4({ method, url, headers = {}, body = "", service, region, accessKey, secretKey, amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, "") }) {
  const u = new URL(url);
  const h = { ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])), host: u.host, "x-amz-date": amzDate };
  const names = Object.keys(h).sort();
  const canonHeaders = names.map((n) => `${n}:${h[n]}\n`).join("");
  const signed = names.join(";");
  const query = [...u.searchParams.entries()].map(([k, v]) => [enc(k), enc(v)]).sort((a, b) => (a[0] === b[0] ? (a[1] < b[1] ? -1 : 1) : a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join("&");
  const canonical = [method, u.pathname.split("/").map((s) => enc(decodeURIComponent(s))).join("/") || "/", query, canonHeaders, signed, sha(body)].join("\n");
  const day = amzDate.slice(0, 8);
  const scope = `${day}/${region}/${service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha(canonical)].join("\n");
  const key = hmac(hmac(hmac(hmac("AWS4" + secretKey, day), region), service), "aws4_request");
  const signature = createHmac("sha256", key).update(toSign).digest("hex");
  return { authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signed}, Signature=${signature}`, headers: h };
}

/** Chamada genérica assinada. `path` pode ter query string. Devolve {status, text, json}. */
export async function awsCall({ service, region, method = "GET", path = "/", body = "", headers = {}, host, accessKey, secretKey, fetchImpl = globalThis.fetch }) {
  const url = `https://${host ?? `${service}.${region}.amazonaws.com`}${path}`;
  const { authorization, headers: h } = signV4({ method, url, headers, body, service, region, accessKey, secretKey });
  const res = await fetchImpl(url, { method, headers: { ...h, authorization }, body: body || undefined, signal: AbortSignal.timeout(25_000) });
  const text = await res.text();
  let json = null; try { json = text ? JSON.parse(text) : null; } catch { /* XML ou vazio */ }
  return { status: res.status, text, json };
}

/** Quem é o dono da chave (STS GetCallerIdentity): confirma que a chave funciona sem exigir nenhuma permissão. */
export async function whoAmI(accessKey, secretKey, opts = {}) {
  const r = await awsCall({ service: "sts", region: "us-east-1", host: "sts.amazonaws.com", method: "POST", path: "/", body: "Action=GetCallerIdentity&Version=2011-06-15", headers: { "content-type": "application/x-www-form-urlencoded; charset=utf-8" }, accessKey, secretKey, ...opts });
  if (r.status !== 200) {
    const code = /<Code>([^<]+)<\/Code>/.exec(r.text)?.[1] ?? "";
    if (code === "InvalidClientTokenId" || code === "SignatureDoesNotMatch") throw new Error(`A AWS recusou a chave (${code}). Confira se copiou a Access key ID e a Secret inteiras.`);
    throw new Error(`Resposta inesperada da AWS: HTTP ${r.status}${code ? ` (${code})` : ""}.`);
  }
  const g = (t) => new RegExp(`<${t}>([^<]+)</${t}>`).exec(r.text)?.[1] ?? "?";
  return { account: g("Account"), arn: g("Arn") };
}
