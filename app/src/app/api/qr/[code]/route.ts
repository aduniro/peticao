import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";
const CODE = /^[0-9A-HJKMNP-TV-Z]{10}$/i; // código de verificação (Crockford base32), o mesmo impresso no PDF

/** QR Code (PNG) que abre a página pública de verificação da assinatura: usado no e-mail de confirmação. */
export async function GET(_req: NextRequest, { params }: { params: { code: string } }) {
  const code = params.code.replace(/\.png$/i, "").replace(/-/g, "").toUpperCase();
  if (!CODE.test(code)) return new NextResponse("Não encontrado", { status: 404 });
  const url = `${config.appUrl().replace(/\/$/, "")}/verificar/${code}`;
  const png = await QRCode.toBuffer(url, { width: 360, margin: 1, errorCorrectionLevel: "M", color: { dark: "#05382a", light: "#ffffff" } });
  return new NextResponse(new Uint8Array(png), { headers: { "content-type": "image/png", "cache-control": "public, max-age=86400" } });
}
