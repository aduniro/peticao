import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { config } from "./config";

export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** HMAC com segredo (pepper): evita força bruta sobre o espaço pequeno de CPFs. */
export const hmac = (s: string) => createHmac("sha256", config.pepper()).update(s).digest("hex");

export const newToken = () => randomBytes(32).toString("base64url");

export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const normalizeEmail = (e: string) => e.trim().toLowerCase();
