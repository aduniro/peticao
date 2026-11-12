import { notFound, redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-levels";
import { hmac } from "@/lib/security";
import MateriaisBiblioteca from "@/components/admin/MateriaisBiblioteca";

export const dynamic = "force-dynamic";
export const metadata = { title: "Materiais", robots: { index: false } };

export default async function Materiais() {
  if (process.env.MATERIALS_LIBRARY_ENABLED !== "1") notFound();
  const s = await sessaoAdmin();
  if (!s) redirect("/admin");
  if (!nivelOk(s.nivel, "leitura")) redirect("/admin?erro=nivel");
  if (s.userId < 1 || !s.sessaoId || s.trocarSenha) redirect("/admin/conta");
  // Scope is an identity fence for client state, never a session token or API authority.
  const scope = hmac(`materials-ui:${s.userId}:${s.sessaoId}:${s.nivel}`);
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
        <MateriaisBiblioteca actorId={s.userId} actorScope={scope} nivel={s.nivel} />
      </div>
    </main>
  );
}
