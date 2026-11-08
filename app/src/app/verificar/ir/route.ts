import { NextRequest, NextResponse } from "next/server";
import { parseCode } from "@/lib/verify-code";

export const dynamic = "force-dynamic";

/** Leva o código digitado (com ou sem traço) para /verificar/CODIGO. */
export function GET(req: NextRequest) {
  const c = parseCode(req.nextUrl.searchParams.get("c") ?? "");
  return NextResponse.redirect(new URL(c ? `/verificar/${c}` : "/verificar/invalido", req.nextUrl.origin), 303);
}
