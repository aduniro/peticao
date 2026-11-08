import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { adminMirrorEnabled } from "@/lib/admin-mirror";
import { query } from "@/lib/db";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!adminMirrorEnabled()) return NextResponse.json({ ok: false }, { status: 404 });
  const denied = await exigirNivel(req, "leitura", 180);
  if (denied) return denied;
  const result = await query("SELECT revision,captured_at,synced_at FROM public.admin_mirror_state WHERE singleton=true");
  const row = result.rows[0];
  if (!row) return NextResponse.json({ ok: false }, { status: 503 });
  return NextResponse.json({ revision: row.revision, capturedAt: row.captured_at, syncedAt: row.synced_at }, { headers: { "cache-control": "no-store" } });
}
