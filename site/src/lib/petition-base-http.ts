import { NextResponse } from "next/server";
import { readLimitedText } from "./http-body";

export const baseReply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
export const baseStatus = (error: string) => error === "forbidden" ? 403 : error === "not_found" ? 404 : error === "parameters" ? 400 : 409;
/** Commands contain identities and review expectations only, never verifier claims or server paths. */
export async function readBaseCommand(req: Request, keys: readonly string[]) {
  if (!/^application\/json(?:;|$)/i.test(req.headers.get("content-type") ?? "")) return { ok: false as const, status: 400 };
  const body = await readLimitedText(req, 2048); if (!body.ok) return body;
  let value: unknown; try { value = JSON.parse(body.raw); } catch { return { ok: false as const, status: 400 }; }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join(",") !== [...keys].sort().join(",")) return { ok: false as const, status: 400 };
  return { ok: true as const, value: value as Record<string, unknown> };
}
