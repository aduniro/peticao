import { NextRequest, NextResponse } from "next/server";
import { clientIp } from "@/lib/net";
import { isProd } from "@/lib/config";
import { SUBSCRIBER_COOKIE, SubscriberError, subscriberAccessEnabled, subscriberOriginAllowed,
  subscriberMe, subscriberEnroll, subscriberLogin, subscriberLogout, subscriberForgot,
  subscriberReset, subscriberPassword, subscriberChange, subscriberConfirmChange } from "@/lib/subscriber-access";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const response = (data: unknown, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" } });
const disabled = () => response({ error: "Não encontrado." }, 404);
const sessionToken = (req: NextRequest) => req.cookies.get(SUBSCRIBER_COOKIE)?.value ?? "";
function errorResponse(error: unknown) {
  if (error instanceof SubscriberError) return response({ error: error.message, code: error.code }, error.status);
  // Do not log request bodies, credentials, tokens or mail content.
  return response({ error: "Não foi possível concluir. Tente novamente mais tarde." }, 503);
}
export async function GET(req: NextRequest, { params }: { params: { action: string } }) {
  if (!subscriberAccessEnabled() || params.action !== "me") return disabled();
  try { return response(await subscriberMe(sessionToken(req))); } catch (error) { return errorResponse(error); }
}
export async function POST(req: NextRequest, { params }: { params: { action: string } }) {
  if (!subscriberAccessEnabled()) return disabled();
  if (!subscriberOriginAllowed(req.headers.get("origin"))) return response({ error: "Origem não autorizada." }, 403);
  if (!req.headers.get("content-type")?.startsWith("application/json")) return response({ error: "Pedido inválido." }, 400);
  const actions = new Set(["enroll", "login", "logout", "forgot", "reset", "password", "change", "confirm-change"]);
  if (!actions.has(params.action)) return disabled();
  try {
    const reader = req.body?.getReader();
    if (!reader) return response({ error: "Pedido inválido." }, 400);
    const chunks: Uint8Array[] = []; let size = 0;
    try {
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break;
        size += chunk.value.byteLength;
        if (size > 8192) { await reader.cancel(); return response({ error: "Pedido grande demais." }, 413); }
        chunks.push(chunk.value);
      }
    } finally { reader.releaseLock(); }
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!body || typeof body !== "object" || Array.isArray(body)) return response({ error: "Pedido inválido." }, 400);
    const ctx = { ip: clientIp(req.headers) }, token = sessionToken(req);
    if (params.action === "login") {
      const value = await subscriberLogin(body, ctx);
      const res = response({ ok: true });
      res.cookies.set(SUBSCRIBER_COOKIE, value.token, { path: "/", httpOnly: true, secure: isProd, sameSite: "strict", maxAge: value.maxAge });
      return res;
    }
    if (params.action === "enroll") return response(await subscriberEnroll(body.email, ctx));
    if (params.action === "forgot") return response(await subscriberForgot(body.email, ctx));
    if (params.action === "reset") return response(await subscriberReset(String(body.token ?? ""), body.password, body.passwordConfirmation, ctx));
    if (params.action === "change") return response(await subscriberChange(token, body, ctx));
    if (params.action === "confirm-change") return response(await subscriberConfirmChange(token, String(body.token ?? ""), ctx));
    const result = params.action === "password" ? await subscriberPassword(token, body.password, body.passwordConfirmation, ctx) : await subscriberLogout(token);
    const res = response(result);
    res.cookies.set(SUBSCRIBER_COOKIE, "", { path: "/", httpOnly: true, secure: isProd, sameSite: "strict", maxAge: 0 });
    return res;
  } catch (error) {
    if (error instanceof SyntaxError) return response({ error: "Pedido inválido." }, 400);
    return errorResponse(error);
  }
}
