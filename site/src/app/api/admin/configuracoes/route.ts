import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { audit, tx } from "@/lib/db";
import { ehChavePainel, gravarConfigPainel, lerConfigPainel } from "@/lib/painel-config";

export const dynamic = "force-dynamic";

/** Preferências de exibição do painel. Ler: qualquer nível. Gravar: só nível total, uma chave da lista fixa por vez (sem texto livre). */
export async function GET(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "leitura", 120);
  if (bloqueio) return bloqueio;
  return NextResponse.json({ ok: true, config: await lerConfigPainel() }, { headers: { "cache-control": "no-store" } });
}
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 60);
  if (bloqueio) return bloqueio;
  const s = await quemAge(req);
  if (!s) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const b = await req.json().catch(() => null);
  if (!ehChavePainel(b?.chave) || typeof b?.valor !== "boolean") return NextResponse.json({ ok: false, erro: "pedido_invalido" }, { status: 400 });
  await tx(async client => {
    await gravarConfigPainel(b.chave, b.valor, client);
    await audit("painel_config", null, { chave: b.chave, valor: b.valor, por: s.email }, client);
  });
  return NextResponse.json({ ok: true, config: await lerConfigPainel() });
}
