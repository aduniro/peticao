import { cifrar, decifrar } from "./crypto-dados";

export type ContactDraftInput = { assunto: string; corpo: string };
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export function validDraftInput(value: unknown): value is ContactDraftInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 2 && typeof v.assunto === "string" && v.assunto.length <= 150 && !/[\r\n\0]/.test(v.assunto)
    && typeof v.corpo === "string" && v.corpo.length <= 5000 && !v.corpo.includes("\0") && !!(v.assunto.trim() || v.corpo.trim());
}
/** A draft may be incomplete. It is never a validated or authorized email submission. */
export function encryptDraft(id: string, input: ContactDraftInput): string {
  if (!UUID.test(id) || !validDraftInput(input)) throw new Error("draft_parameters");
  return cifrar(JSON.stringify(input), `contact-draft:v1:${id}`);
}
export function decryptDraft(id: string, cipher: string): ContactDraftInput | null {
  if (!UUID.test(id)) return null;
  try {
    const raw = decifrar(cipher, `contact-draft:v1:${id}`);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return validDraftInput(value) ? value : null;
  } catch { return null; }
}
