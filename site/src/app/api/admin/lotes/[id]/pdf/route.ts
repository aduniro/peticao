import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { query, audit } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  const bloqueio = await exigirNivel(req, "total");
  if (bloqueio) return bloqueio;
  const id = Number(params.id);
  const signed = req.nextUrl.searchParams.get("assinado") === "1";
  const r = await query<{ pdf: Buffer | null; seq: number }>(`SELECT ${signed ? "signed_pdf" : "pdf"} AS pdf, seq FROM batches WHERE id=$1`, [id]);
  if (!r.rows[0]?.pdf) return new NextResponse("Não encontrado", { status: 404 });
  await audit("batch_pdf_downloaded", null, { batchId: id });
  return new NextResponse(new Uint8Array(r.rows[0].pdf), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="lote-${r.rows[0].seq}${signed ? "-assinado" : ""}.pdf"` } });
}
