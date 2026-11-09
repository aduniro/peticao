import { getKey } from "/mnt/apps/peticao-final/peticao/tools/infra/lib/keystore.mjs";
export const DOMINIO = "docentes.magisteriofederal.org";
export const ENDERECO = `ponte@${DOMINIO}`;
export const DONO = "operator-1608598f41@example.invalid";
const H = () => ({ Authorization: "Bearer " + getKey("CLOUDFLARE_API_TOKEN") });
export const cf = async (p, o = {}) => { const r = await fetch("https://api.cloudflare.com/client/v4" + p, { ...o, headers: { ...H(), ...(o.headers ?? {}) } }); const t = await r.text(); try { return JSON.parse(t); } catch { return { success: false, raw: t.slice(0, 300) }; } };
export const conta = async () => (await cf("/zones?name=magisteriofederal.org")).result[0];
export const kvId = async (acc) => (await cf(`/accounts/${acc}/storage/kv/namespaces?per_page=100`)).result.find((n) => n.title === "ponte-caixa")?.id;
