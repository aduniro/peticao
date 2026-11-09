import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { readContactDraft, writeContactDraft } from "@/lib/contact-drafts";
import { readLimitedText } from "@/lib/http-body";
export const dynamic = "force-dynamic";
const reply = (value: unknown, status = 200) => NextResponse.json(value, { status, headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
export async function GET(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 120, { stepup: true }); if (denied) return denied;
  const p = req.nextUrl.searchParams, actor = await quemAge(req);
  if (!actor?.userId) return reply({ ok: false, error: "forbidden" }, 403);
  if (p.size !== 1 || p.getAll("contato").length !== 1 || !/^[1-9]\d{0,9}$/.test(p.get("contato") ?? "")) return reply({ ok: false, error: "parameters" }, 400);
  try { const result = await readContactDraft(Number(p.get("contato")), actor); return reply(result, result.ok ? 200 : result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : 400); }
  catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
export async function POST(req: NextRequest) {
  const denied = await exigirNivel(req, "total", 60, { stepup: true }); if (denied) return denied;
  const actor = await quemAge(req); if (!actor?.userId) return reply({ ok: false, error: "forbidden" }, 403);
  const body = await readLimitedText(req, 32_768); if (!body.ok) return reply({ ok: false, error: "parameters" }, body.status);
  let value: any; try { value = JSON.parse(body.raw); } catch { return reply({ ok: false, error: "parameters" }, 400); }
  if (!value || Array.isArray(value) || typeof value !== "object" || Object.keys(value).sort().join(",") !== "contactId,input,revision") return reply({ ok: false, error: "parameters" }, 400);
  try { const result = await writeContactDraft(value.contactId, value.revision, value.input, actor); return reply(result, result.ok ? 200 : result.error === "conflict" ? 409 : result.error === "not_found" ? 404 : result.error === "forbidden" ? 403 : 400); }
  catch { return reply({ ok: false, error: "unavailable" }, 503); }
}
