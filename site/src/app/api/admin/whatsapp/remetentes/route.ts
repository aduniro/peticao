import { NextRequest, NextResponse } from "next/server";
import { exigirNivel } from "@/lib/admin-api";
import { query, audit } from "@/lib/db";
import { cifrar } from "@/lib/crypto-dados";
import { normalizarTelefone } from "@/lib/whatsapp/telefone";

export const dynamic = "force-dynamic";

/** Cadastro dos números remetentes do WhatsApp (cifrados). Só registra: o envio real depende de o recurso estar ligado e configurado. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 60);
  if (bloqueio) return bloqueio;
  const f = await req.formData();
  const volta = (msg: string) => NextResponse.redirect(new URL(`/admin/whatsapp?msg=${encodeURIComponent(msg)}`, req.url), 303);
  const acao = String(f.get("acao") ?? "");
  if (acao === "add") {
    const rotulo = String(f.get("rotulo") ?? "").trim().slice(0, 60);
    const t = normalizarTelefone(f.get("ddi"), f.get("numero"));
    if (!rotulo) return volta("Informe um nome para o remetente.");
    if (!t.ok) return volta("Número inválido: confira o DDI e o número.");
    const ex = (await query("SELECT 1 FROM whatsapp_senders")).rowCount ?? 0;
    if (ex >= 20) return volta("Limite de 20 remetentes.");
    const r = await query<{ id: number }>("INSERT INTO whatsapp_senders(label, phone_cipher, phone_last4) VALUES($1,'',$2) RETURNING id", [rotulo, t.e164.slice(-4)]);
    await query("UPDATE whatsapp_senders SET phone_cipher=$2 WHERE id=$1", [r.rows[0].id, cifrar(t.e164, `wa-sender:${r.rows[0].id}`)]);
    await audit("whatsapp_sender_added", null, { id: r.rows[0].id, final: t.e164.slice(-4) });
    return volta("Remetente cadastrado.");
  }
  const id = Number(f.get("id"));
  if (!Number.isInteger(id)) return volta("Remetente inválido.");
  if (acao === "toggle") { await query("UPDATE whatsapp_senders SET active = NOT active WHERE id=$1", [id]); await audit("whatsapp_sender_toggled", null, { id }); return volta("Remetente atualizado."); }
  if (acao === "remove") { await query("DELETE FROM whatsapp_senders WHERE id=$1", [id]); await audit("whatsapp_sender_removed", null, { id }); return volta("Remetente removido."); }
  return volta("Ação desconhecida.");
}
