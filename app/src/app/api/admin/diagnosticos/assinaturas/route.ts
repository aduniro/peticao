import { NextRequest, NextResponse } from "next/server";
import { exigirAdmin } from "@/lib/admin-api";
import { signupDiagnosticPage } from "@/lib/signup-diagnostics";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  const denied = exigirAdmin(req); if (denied) return denied;
  const q = req.nextUrl.searchParams;
  if (q.has("offset") && !/^(?:0|[1-9][0-9]{0,6})$/.test(q.get("offset")!) || [...q.keys()].some(k => k !== "limit" && k !== "emails" && k !== "offset") || q.has("limit") && !/^(?:[1-9]|[1-9][0-9]|100)$/.test(q.get("limit")!) || q.has("emails") && !["0", "1"].includes(q.get("emails")!)) return NextResponse.json({ ok: false }, { status: 400 });
  return NextResponse.json({ ok: true, ...await signupDiagnosticPage(Number(q.get("limit") ?? 50), q.get("emails") === "1", Number(q.get("offset") ?? 0)), partialFormValuesCollected: false, identityValuesCollected: false }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
}
