import { NextRequest, NextResponse } from "next/server";
import { config } from "@/lib/config";
import { clientIp } from "@/lib/net";
import { rateLimit } from "@/lib/ratelimit";
import { parseBrowserDiagnostic, persistDiagnostic } from "@/lib/signup-diagnostics";
export const dynamic = "force-dynamic";
export async function POST(req: NextRequest) {
  const reply = (status: number) => new NextResponse(null, { status, headers: { "cache-control": "no-store" } });
  if (req.headers.get("origin") !== new URL(config.appUrl()).origin) return reply(403);
  if (req.headers.get("dnt") === "1" || req.headers.get("sec-gpc") === "1") return reply(204);
  if (!rateLimit(`sign-diagnostic:${clientIp(req.headers)}`, 1200, 60000)) return reply(429);
  try {
    const reader = req.body?.getReader(); if (!reader) return reply(400);
    let length = 0; const chunks: Uint8Array[] = [];
    try { while (true) { const r = await reader.read(); if (r.done) break; length += r.value.byteLength; if (length > 2048) return reply(413); chunks.push(r.value); } }
    finally { void reader.cancel().catch(() => {}); }
    const input = parseBrowserDiagnostic(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))));
    if (!input) return reply(400);
    if (!rateLimit(`sign-diagnostic-trace:${input.trace}`, 120, 60000)) return reply(429);
    return reply(await persistDiagnostic(input) ? 204 : 503);
  } catch { return reply(400); }
}
