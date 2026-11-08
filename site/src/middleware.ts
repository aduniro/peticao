import { NextRequest, NextResponse } from "next/server";
import { adminMirrorEnabled, mirrorRequestAllowed } from "./lib/admin-mirror";

export function middleware(req: NextRequest) {
  if (adminMirrorEnabled() && !mirrorRequestAllowed(req.method, req.nextUrl.pathname)) {
    return NextResponse.json({ ok: false, code: "ADMIN_MIRROR_READ_ONLY" }, {
      status: 403,
      headers: { "Cache-Control": "no-store" },
    });
  }
  return NextResponse.next();
}

export const config = { matcher: "/:path*" };
