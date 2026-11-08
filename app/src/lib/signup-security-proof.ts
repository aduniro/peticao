import { hmac, safeEqual } from "./security";

type IdentityInput = { category: string; name: string; email: string; cpf?: string };
const signature = (input: IdentityInput, ticket: string, expiry: string) =>
  hmac(`signup-security:v1:${JSON.stringify([expiry, ticket.split(".").slice(0, 2).join("."), input.category, input.name, input.email, input.cpf ?? null])}`);

/** Older open tabs already carry the identity ticket, but do not know new JSON fields. */
export function signupSecurityProofFromTicket(ticket: unknown): string | undefined {
  if (typeof ticket !== "string") return undefined;
  const parts = ticket.split(".");
  return parts.length === 4 ? parts.slice(2).join(".") : undefined;
}

/** Stateless proof of a successful challenge, limited to the existing identity ticket. */
export function makeSignupSecurityProof(input: IdentityInput, ticket: string): string {
  const expiry = ticket.split(".")[0];
  return `${expiry}.${signature(input, ticket, expiry)}`;
}

export function checkSignupSecurityProof(proof: unknown, input: IdentityInput, ticket: unknown, now = Date.now()): boolean {
  if (typeof proof !== "string" || typeof ticket !== "string" || !/^\d{13}\.[a-f0-9]{64}$/.test(proof)) return false;
  if (![2, 4].includes(ticket.split(".").length)) return false;
  const embedded = signupSecurityProofFromTicket(ticket);
  if (embedded && embedded !== proof) return false;
  const [expiry, mac] = proof.split(".");
  if (expiry !== ticket.split(".")[0] || Number(expiry) <= now || Number(expiry) > now + 15 * 60_000) return false;
  return safeEqual(mac, signature(input, ticket, expiry));
}
