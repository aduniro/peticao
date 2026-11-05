import { NextRequest, NextResponse } from "next/server";
import { ADMIN_COOKIE } from "@/lib/admin";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Encerra a sessão do painel (apaga o cookie) e volta para a tela de acesso. */
export async function POST(req: NextRequest) {
  const res = NextResponse.redirect(new URL("/admin", requestOrigin(req.headers)), 303);
  res.cookies.set(ADMIN_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  return res;
}
