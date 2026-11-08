import { NextRequest, NextResponse } from "next/server";
import { referrerByCode, CODE_RE } from "@/lib/referrals";
import { cardSvg, renderPng } from "@/lib/card";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

/** Cartaz PNG com o QR pessoal. `?baixar=1` força o download. */
export async function GET(req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.replace(/\.png$/i, "").toUpperCase();
  const ref = CODE_RE.test(code) ? await referrerByCode(code) : null;
  if (!ref) return new NextResponse("Não encontrado", { status: 404 });
  const w = Number(req.nextUrl.searchParams.get("w"));
  const width = Number.isFinite(w) && w >= 360 && w <= 1080 ? Math.round(w) : 1080; // e-mail usa versão menor (carrega rápido)
  const base = config.appUrl().replace(/\/$/, "");
  const link = `${base}/r/${ref.code}`;
  const png = renderPng(cardSvg({ link, displayLink: link.replace(/^https?:\/\//, ""), firstName: ref.display_name }), width);
  const headers: Record<string, string> = { "content-type": "image/png", "cache-control": "public, max-age=3600" };
  if (req.nextUrl.searchParams.get("baixar")) headers["content-disposition"] = `attachment; filename="cartaz-plv12-${ref.code}.png"`;
  return new NextResponse(new Uint8Array(png), { headers });
}
