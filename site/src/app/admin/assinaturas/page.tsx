import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { redirect } from "next/navigation";
import Explorador from "@/components/admin/Explorador";
import { filtrosParaQuery, parseFiltros } from "@/lib/assinaturas-explorar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assinaturas", robots: { index: false } };

export default async function Assinaturas({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "leitura")) redirect("/admin?erro=nivel");
  const qs = filtrosParaQuery(parseFiltros(new URLSearchParams(Object.entries(searchParams).filter(([, v]) => typeof v === "string") as [string, string][])));
  return (
    <main className="adm-page">
      <h1>Assinaturas</h1>
      <p className="adm-sub">Os filtros valem para o mapa e para a tabela ao mesmo tempo. Clique em um círculo para filtrar a tabela por aquele local.</p>
      <Explorador inicial={qs} />
    </main>
  );
}
