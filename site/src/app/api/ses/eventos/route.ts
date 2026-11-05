import { NextRequest, NextResponse } from "next/server";
import { handleSns, type SnsMessage } from "@/lib/mail/ses-events";

export const dynamic = "force-dynamic";

/** Recebe do Amazon SNS os avisos de bounce/reclamação do SES. A autenticidade vem da assinatura do SNS, não de senha. */
export async function POST(req: NextRequest) {
  const raw = await req.text(); // o SNS envia Content-Type text/plain
  if (raw.length > 256_000) return new NextResponse("grande demais", { status: 413 });
  let m: SnsMessage;
  try { m = JSON.parse(raw); } catch { return new NextResponse("JSON inválido", { status: 400 }); }
  if (!m || typeof m !== "object" || typeof m.Type !== "string") return new NextResponse("mensagem inválida", { status: 400 });
  try {
    const r = await handleSns(m);
    if (r.status >= 400) console.warn("ses/eventos recusado:", r.status, r.body);
    return new NextResponse(r.body, { status: r.status });
  } catch (e) {
    console.error("ses/eventos falhou", e);
    return new NextResponse("erro", { status: 500 });
  }
}
