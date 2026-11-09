import { createHmac } from "node:crypto";
import { readSecret } from "../secrets";
import { safeEqual } from "../security";
import { validAccountScope } from "./event-scope";

export type WebhookConfig = { scope?: string; secret?: string };
export function webhookConfig(provider: string): WebhookConfig {
  const prefix = provider === "brevo" ? "BREVO" : provider === "mailersend" ? "MAILERSEND" : provider === "sendpulse" ? "SENDPULSE" : undefined;
  if (!prefix) return {};
  const secret = provider === "brevo" ? readSecret("BREVO_WEBHOOK_TOKEN", "brevo-webhook-token")
    : provider === "mailersend" ? readSecret("MAILERSEND_WEBHOOK_SIGNING_SECRET", "mailersend-webhook-signing")
    : readSecret("SENDPULSE_WEBHOOK_SIGNING_SECRET", "sendpulse-webhook-signing");
  return {scope:process.env[`${prefix}_WEBHOOK_ACCOUNT_SCOPE`],secret:secret || undefined};
}
/** A configured but incomplete account binding fails closed. No scope is inferred from a current API key. */
export function authenticateWebhook(provider: string, raw: string, headers: Headers, config: WebhookConfig, urlSecret: string): {status:200 | 401 | 503; scope?: string} {
  const {scope,secret}=config;
  if (scope !== undefined && (!validAccountScope(scope) || !secret || secret.length < 32 || safeEqual(secret,urlSecret))) return {status:503};
  if (!secret) return {status:200}; // Legacy aggregate only; there is no authenticated account for individual correlation.
  const expected = provider === "brevo" ? `Bearer ${secret}` : createHmac("sha256",secret).update(raw).digest("hex");
  const received = headers.get(provider === "brevo" ? "authorization" : provider === "mailersend" ? "signature" : "x-signature") ?? "";
  const value = provider === "sendpulse" ? `sha256=${expected}` : expected;
  return safeEqual(received,value) ? {status:200,scope} : {status:401};
}
/** MailerSend's public URL-validation key can acknowledge only its inert test envelope, never an activity. */
export function mailersendTestPing(payload: unknown, raw: string, headers: Headers) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) || (payload as {type?:unknown}).type !== "webhook.test") return false;
  const expected=createHmac("sha256","test_Am3L1GuOIc4blLUuHqAPxxwkZaJyEk8G").update(raw).digest("hex");
  return safeEqual(headers.get("signature")??"",expected);
}
export { readLimitedText as webhookBody } from "../http-body";
