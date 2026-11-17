import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readContactHistory, validHistoryId } from "@/lib/contact-history";

export const dynamic = "force-dynamic";
const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: { "cache-control": "no-store" } });
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "edicao", 30);
  if (denied) return denied;
  const q = req.nextUrl.searchParams;
  if (!q.has("contato") || [...q.keys()].some(key => !["contato", "replyBefore", "campusBefore", "limit"].includes(key) || q.getAll(key).length !== 1)
    || [...q.values()].some(value => !/^[1-9]\d{0,9}$/.test(value) || !validHistoryId(Number(value)))) return reply({ ok: false, error: "parameters" }, 400);
  const actor = await quemAge(req);
  if (!actor) return reply({ ok: false, error: "forbidden" }, 403);
  try {
    const result = await readContactHistory(Number(q.get("contato")), actor, {
      ...(q.has("replyBefore") ? { replyBefore: Number(q.get("replyBefore")) } : {}),
      ...(q.has("campusBefore") ? { campusBefore: Number(q.get("campusBefore")) } : {}),
      ...(q.has("limit") ? { limit: Number(q.get("limit")) } : {}),
    });
    return reply(result, result.ok ? 200 : result.error === "parameters" ? 400 : result.error === "forbidden" ? 403 : 404);
  } catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
