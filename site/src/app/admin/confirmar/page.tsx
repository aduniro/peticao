import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import Confirmar from "@/components/admin/Confirmar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Confirmar acesso", robots: { index: false } };

/** Só aceita voltar para dentro do painel (nunca para um endereço de fora). */
const destino = (v?: string) => (v && /^\/admin(\/[a-z0-9-]*)*$/.test(v) ? v : "/admin/acoes");

export default async function ConfirmarPagina({ searchParams }: { searchParams: { volta?: string } }) {
  const s = await sessaoAdmin();
  if (!s) redirect("/admin");
  if (!nivelOk(s.nivel, "total")) redirect("/admin?erro=nivel");
  const volta = destino(searchParams.volta);
  if (stepupValido(s)) redirect(volta);
  return (
    <main>
      <p><a href="/admin">← Painel</a></p>
      <h1>Confirmar o seu acesso</h1>
      {s.userId ? <Confirmar email={s.email} volta={volta} /> : <p className="box err" role="alert">Este acesso (senha única de transição) não tem e-mail para receber o código. Crie o usuário dono com <code>admin-dono.mjs</code> e entre com ele.</p>}
    </main>
  );
}
