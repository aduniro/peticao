import { NextResponse } from "next/server";
import { ogSvg, renderPng } from "@/lib/card";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

export function GET() {
  const png = renderPng(ogSvg(config.appUrl().replace(/^https?:\/\//, "")), 1200);
  return new NextResponse(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
}
