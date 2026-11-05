import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { alertasEmail } from "@/lib/mail/alertas";
import { query } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Contagem de alertas por área, para os pontos vermelhos do menu do painel. */
export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "leitura");
  if (bloqueio) return bloqueio;
  const emails = (await alertasEmail().catch(() => [])).length;
  const lotes = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM batches WHERE status='prepared'").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  const contato = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM contact_messages WHERE created_at > now() - interval '48 hours'").catch(() => ({ rows: [{ n: 0 }] }))).rows[0].n;
  return NextResponse.json({ emails, lotes, contato }, { headers: { "cache-control": "no-store" } });
}
