import { NextResponse } from "next/server";
import { counts } from "@/lib/signatures";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await counts(), { headers: { "cache-control": "public, max-age=15" } });
}
