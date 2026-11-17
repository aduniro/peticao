import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { lerConfigPainel } from "@/lib/painel-config";
import Configuracoes from "@/components/admin/Configuracoes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Configurações", robots: { index: false } };

export default async function ConfiguracoesPagina() {
  const s = await sessaoAdmin();
  if (!s) redirect("/admin");
  if (!nivelOk(s.nivel, "total")) redirect("/admin?erro=nivel");
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
        <h1>Configurações do painel</h1>
        <p className="v2-sub">Preferências de exibição da visão geral. Valem para todos os usuários do painel.</p>
        <Configuracoes inicial={await lerConfigPainel()} podeEditar />
      </div>
    </main>
  );
}
