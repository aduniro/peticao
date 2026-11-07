import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-api";
import { readSignupDiagnostics } from "@/lib/signup-diagnostics";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = exigirAdmin(req); if (denied) return denied;
  const q = req.nextUrl.searchParams;
  if ([...q.keys()].some(k => k !== "limit" && k !== "emails") || q.has("limit") && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(q.get("limit")!) || q.has("emails") && !["0", "1"].includes(q.get("emails")!)) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ ok: true, records: await readSignupDiagnostics(Number(q.get("limit") ?? 50), q.get("emails") === "1"), partialFormValuesCollected: false, identityValuesCollected: false }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
