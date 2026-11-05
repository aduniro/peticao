import { NextResponse } from "next/server";
import { iconSvg, renderPng } from "@/lib/card";

export const dynamic = "force-dynamic";
export function GET() {
  return new NextResponse(new Uint8Array(renderPng(iconSvg(), 512)), { headers: { "content-type": "image/png", "cache-control": "public, max-age=604800" } });
}
