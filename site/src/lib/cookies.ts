import type { NextRequest } from "next/server";

/** Cookies próprios (visitante e indicação): HttpOnly, SameSite=Lax, Secure quando a conexão é HTTPS. */
export function cookieOpts(req: NextRequest, maxAge: number) {
  const https = req.headers.get("x-forwarded-proto") === "https" || req.nextUrl.protocol === "https:";
  return { httpOnly: true, sameSite: "lax" as const, path: "/", maxAge, secure: https };
}
