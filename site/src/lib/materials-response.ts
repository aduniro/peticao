import { NextResponse } from "next/server";
/** API machine codes only; user-facing copy/layout is outside this draft. */
export function materialResponse(value: { ok: boolean; error?: string }) {
  const status = value.ok ? 200 : value.error === "parameters" ? 400 : value.error === "forbidden" ? 403 : value.error === "not_found" ? 404 : ["disabled", "conflict", "request_conflict", "archived"].includes(value.error ?? "") ? 409 : 503;
  return NextResponse.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
