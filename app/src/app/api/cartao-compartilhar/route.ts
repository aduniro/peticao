import { NextRequest, NextResponse } from "next/server";
import { cardSvg, renderPng } from "@/lib/card";
import { config } from "@/lib/config";
import { publicOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Cartaz geral (sem link pessoal) para compartilhar a petição. `?baixar=1` força o download. */
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req.headers, config.appUrl()).replace(/\/$/, "");
  const png = renderPng(cardSvg({ link: origin, displayLink: origin.replace(/^https?:\/\//, "") }), 1080);
  const headers: Record<string, string> = { "content-type": "image/png", "cache-control": "private, max-age=600", vary: "host, x-forwarded-host, x-forwarded-proto" };
  if (req.nextUrl.searchParams.get("baixar")) headers["content-disposition"] = 'attachment; filename="cartaz-plv12.png"';
  return new NextResponse(new Uint8Array(png), { headers });
}
