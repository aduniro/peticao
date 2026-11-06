import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { enviarResposta, montarPrevia, validarEntrada } from "@/lib/contact-replies";
import { audit, query } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Responder uma mensagem de contato. Nível total + confirmação extra. `modo: "previa"` monta os dois e-mails sem enviar e devolve um selo;
 * `modo: "enviar"` só envia com o selo da prévia do MESMO texto. Corpo: { contactId, modo, assunto, corpo, selo?, nova? }.
 */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 60, { stepup: true });
  if (bloqueio) return bloqueio;
  const s = await quemAge(req);
  const b = await req.json().catch(() => null);
  const id = Number(b?.contactId);
  if (!s || !b || !Number.isInteger(id) || id < 1 || (b.modo !== "previa" && b.modo !== "enviar")) return NextResponse.json({ ok: false, erro: "pedido_invalido" }, { status: 400 });
  const entrada = { assunto: b.assunto, corpo: b.corpo };
  const v = validarEntrada(entrada);
  if (!v.ok) return NextResponse.json({ ok: false, erro: v.erro }, { status: 400 });
  if (b.modo === "previa") {
    const ultima = (await query<{ m: number | null }>("SELECT MAX(rodada)::int m FROM contact_replies WHERE contact_id=$1", [id])).rows[0].m ?? 0;
    const p = await montarPrevia(id, v.v, ultima + 1);
    if (!p) return NextResponse.json({ ok: false, erro: "nao_existe" }, { status: 404 });
    return NextResponse.json({ ok: true, previa: p });
  }
  const r = await enviarResposta({ contactId: id, entrada, selo: String(b.selo ?? ""), nova: b.nova === true, por: { userId: s.userId, email: s.email } });
  await audit("contato_respondido", null, { contato: id, por: s.email, ok: r.ok, ...(r.ok ? { rodada: r.rodada } : { erro: r.erro }) });
  return NextResponse.json(r, { status: r.ok ? 200 : r.erro === "nao_existe" ? 404 : r.erro === "falhou" ? 502 : 409 });
}
