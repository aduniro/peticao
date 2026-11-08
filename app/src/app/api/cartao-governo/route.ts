import { NextRequest, NextResponse } from "next/server";
import { govCardSvg, renderPng } from "@/lib/card";
import { config } from "@/lib/config";
import { publicOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Cartão em tópicos com os pedidos ao Governo. `?baixar=1` força o download. */
export async function GET(req: NextRequest) {
  const origin = publicOrigin(req.headers, config.appUrl()).replace(/\/$/, "");
  const png = renderPng(govCardSvg({ link: origin, displayLink: origin.replace(/^https?:\/\//, "") }), 1080);
  const headers: Record<string, string> = { "content-type": "image/png", "cache-control": "private, max-age=600", vary: "host, x-forwarded-host, x-forwarded-proto" };
  if (req.nextUrl.searchParams.get("baixar")) headers["content-disposition"] = 'attachment; filename="pedido-ao-governo-plv12.png"';
  return new NextResponse(new Uint8Array(png), { headers });
}
