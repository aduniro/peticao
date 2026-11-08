import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { manageSender } from "@/lib/admin-whatsapp-senders";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/** Cadastro dos números remetentes do WhatsApp (cifrados). Só registra: o envio real depende de o recurso estar ligado e configurado. */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 60, { stepup: true });
  if (bloqueio) return bloqueio;
  const session = await quemAge(req);
  if (!session) return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 401 });
  const f = await req.formData();
  const volta = (msg: string, keepArchive = true) => NextResponse.redirect(new URL(`/admin/whatsapp?msg=${encodeURIComponent(msg)}${keepArchive && f.get("arquivados") === "1" ? "&arquivados=1" : ""}`, requestOrigin(req.headers)), 303);
  const acao = String(f.get("acao") ?? "");
  if (!["add", "toggle", "remove", "restore"].includes(acao)) return volta("Ação desconhecida.");
  const result = await manageSender({ userId: session.userId, email: session.email }, acao === "add"
    ? { action: "add", label: String(f.get("rotulo") ?? ""), ddi: f.get("ddi"), number: f.get("numero") }
    : { action: acao as "toggle" | "remove" | "restore", id: Number(f.get("id")), revision: Number(f.get("revision")) });
  if (!result.ok) {
    if (result.erro === "forbidden") return NextResponse.json({ ok: false, erro: "Não autorizado." }, { status: 403 });
    if (result.erro === "conflict") return volta("Este registro mudou desde que a página foi aberta. Atualize a página antes de tentar novamente.");
    return volta(result.erro === "label" ? "Informe um nome para o remetente." : result.erro === "phone" ? "Número inválido: confira o DDI e o número." : result.erro === "limit" ? "Limite de 20 remetentes." : "Remetente inválido.");
  }
  if (acao === "restore") return volta("Remetente restaurado.", false);
  return volta(acao === "add" ? "Remetente cadastrado." : acao === "remove" ? "Remetente removido." : "Remetente atualizado.");
}
