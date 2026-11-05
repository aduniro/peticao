import { readSecret } from "../secrets";

/** Envio de WhatsApp por modelo (template) aprovado. Só o MailerSend por enquanto. Nada funciona enquanto WHATSAPP_ENABLED não for "1" e faltar token/remetente/modelos. */
let teste: WaProvider | null = null;
export type WaMsg = { to: string; templateId: string; body: string[]; buttons?: string[] };
export interface WaProvider { name: string; send(m: WaMsg): Promise<{ id: string }> }

export const waToken = () => readSecret("MAILERSEND_WHATSAPP_TOKEN", "mailersend-whatsapp");
export const waFrom = () => process.env.WHATSAPP_FROM?.replace(/\D/g, "") || null;
export const waTemplates = () => ({ pedido: process.env.WHATSAPP_TEMPLATE_CONFIRM?.trim() || "", pronto: process.env.WHATSAPP_TEMPLATE_DONE?.trim() || "" });

export type WaEstado = { ligado: boolean; token: boolean; remetente: boolean; modeloPedido: boolean; modeloPronto: boolean; pronto: boolean };
export function waEstado(from: string | null = waFrom()): WaEstado {
  const t = waTemplates();
  const e = { ligado: process.env.WHATSAPP_ENABLED === "1", token: !!waToken(), remetente: !!from, modeloPedido: !!t.pedido, modeloPronto: !!t.pronto };
  return { ...e, pronto: e.ligado && e.token && e.remetente && e.modeloPedido && e.modeloPronto };
}
/** Só vale para o público (campo no formulário, pedidos) quando TUDO está configurado. Caso contrário o site se comporta como se o recurso não existisse. */
/** Só desenvolvimento/QA (WHATSAPP_PROVIDER=dev): nada sai; as mensagens vão para um arquivo local. Ignorado em produção. */
const dev = () => process.env.WHATSAPP_PROVIDER === "dev" && process.env.NODE_ENV !== "production";
export const whatsappAtivo = () => !!teste || dev() || waEstado().pronto;

export function mailersendWhatsapp(token: string, from: string, f: typeof fetch = fetch): WaProvider {
  return {
    name: "mailersend",
    async send(m) {
      const r = await f("https://api.mailersend.com/v1/whatsapp/send", {
        method: "POST", signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ from, to: [m.to], template_id: m.templateId, personalization: [{ to: m.to, data: { body: m.body, ...(m.buttons?.length ? { buttons: m.buttons } : {}) } }] }),
      });
      if (r.status !== 202) throw new Error(`MailerSend WhatsApp HTTP ${r.status}`);
      const j: any = await r.json().catch(() => ({}));
      return { id: String(j?.data?.id ?? r.headers.get("x-message-id") ?? "") };
    },
  };
}

export const _setWaProviderForTests = (p: WaProvider | null) => { teste = p; };
export function waProvider(): WaProvider | null {
  if (teste) return teste;
  if (dev()) return devProvider();
  if (!whatsappAtivo()) return null;
  return mailersendWhatsapp(waToken()!, waFrom()!);
}

function devProvider(): WaProvider {
  return {
    name: "dev",
    async send(m) {
      const { appendFileSync } = await import("node:fs");
      const id = `dev-${Date.now()}`;
      appendFileSync(process.env.WHATSAPP_DEV_LOG ?? "/tmp/whatsapp-dev.log", JSON.stringify({ id, ...m }) + "\n");
      return { id };
    },
  };
}
