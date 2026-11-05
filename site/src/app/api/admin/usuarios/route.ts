import { NextRequest, NextResponse } from "next/server";
import { exigirNivel, quemAge } from "@/lib/admin-api";
import { alterarNivel, criarUsuario, definirAtivo, ehNivel, pedirReset } from "@/lib/admin-users";
import { requestOrigin } from "@/lib/net";

export const dynamic = "force-dynamic";

/**
 * Gestão de usuários do painel (só nível total). Ações: criar (manda um convite por e-mail para a pessoa criar a própria senha, nunca se envia senha),
 * nivel, ativar, desativar e redefinir (manda o link de redefinição). O sistema nunca deixa o painel sem nenhum usuário de nível total ativo.
 */
export async function POST(req: NextRequest) {
  const bloqueio = await exigirNivel(req, "total", 40);
  if (bloqueio) return bloqueio;
  const eu = await quemAge(req);
  const origem = requestOrigin(req.headers);
  const volta = (q: string) => NextResponse.redirect(new URL("/admin/usuarios?" + q, origem), 303);
  const f = await req.formData();
  const acao = String(f.get("acao") ?? ""), id = Number(f.get("id")), por = eu?.email ?? "?";
  if (acao === "criar") {
    const email = String(f.get("email") ?? ""), nivel = String(f.get("nivel") ?? "");
    if (!ehNivel(nivel)) return volta("erro=nivel_invalido");
    const r = await criarUsuario({ email, nome: String(f.get("nome") ?? ""), nivel, por });
    if (!r.ok) return volta(`erro=${r.erro}`);
    await pedirReset(r.usuario.email, { origin: origem, convite: true }).catch((e) => console.error("convite falhou:", e instanceof Error ? e.message : e));
    return volta("msg=criado");
  }
  if (!Number.isInteger(id) || id < 1) return volta("erro=nao_existe");
  if (acao === "nivel") { const n = String(f.get("nivel") ?? ""); const r = await alterarNivel(id, n as never, por); return volta(r.ok ? "msg=nivel" : `erro=${r.erro}`); }
  if (acao === "ativar" || acao === "desativar") { const r = await definirAtivo(id, acao === "ativar", por); return volta(r.ok ? `msg=${acao === "ativar" ? "ativado" : "desativado"}` : `erro=${r.erro}`); }
  if (acao === "redefinir") {
    const { query } = await import("@/lib/db");
    const u = (await query<{ email: string }>("SELECT email FROM admin_users WHERE id=$1 AND ativo", [id])).rows[0];
    if (!u) return volta("erro=nao_existe");
    await pedirReset(u.email, { origin: origem }).catch(() => {});
    return volta("msg=link_enviado");
  }
  return volta("erro=acao_invalida");
}
