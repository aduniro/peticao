import { hmac } from "../security";
const PROVIDERS = new Set(["brevo", "mailersend", "sendpulse", "mailrelay", "mailrelaypresidente"]);
export const validAccountScope = (raw: unknown): raw is string => typeof raw === "string" && /^[a-f0-9]{64}$/.test(raw);
/** The process already uses the credential to send/poll. Only a domain-separated keyed fingerprint leaves it. */
export function credentialScope(provider: string, credential: string): string | undefined {
  if (!PROVIDERS.has(provider) || typeof credential!=="string" || !credential || credential.length > 10000) return undefined;
  try { return hmac("mail-account-v1:" + JSON.stringify([provider, credential])); } catch { return undefined; }
}
/** This is the configured authenticated notification topic, not a claimed scope in a webhook payload. */
export function snsScope(topic: unknown, sendingAccount?: unknown): string | undefined {
  if (typeof topic !== "string") return undefined;
  const match=/^arn:(?:aws|aws-cn|aws-us-gov):sns:[a-z0-9-]+:(\d{12}):[A-Za-z0-9_-]{1,256}(?:\.fifo)?$/.exec(topic);
  if(!match)return undefined;
  const account=sendingAccount===undefined?match[1]:sendingAccount;
  if(typeof account!=="string" || !/^\d{12}$/.test(account))return undefined;
  try { return hmac("mail-sns-topic-v1:" + JSON.stringify([topic,account])); } catch { return undefined; }
}

export const sendpulseScope = (id: string, secret: string) => credentialScope("sendpulse",JSON.stringify([id,secret]));
export const mailrelayScope = (provider: string, host: string, key: string) => credentialScope(provider,JSON.stringify([host.toLowerCase(),key]));
