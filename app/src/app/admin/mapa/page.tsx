import { isAdmin } from "@/lib/admin";
import { redirect } from "next/navigation";
import Explorador from "@/components/admin/Explorador";
import { filtrosParaQuery, parseFiltros } from "@/lib/assinaturas-explorar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mapa e assinaturas", robots: { index: false } };

export default function Mapa({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!isAdmin()) redirect("/admin");
  const qs = filtrosParaQuery(parseFiltros(new URLSearchParams(Object.entries(searchParams).filter(([, v]) => typeof v === "string") as [string, string][])));
  return (
    <main className="adm-page">
      <h1>Mapa e assinaturas</h1>
      <p className="adm-sub">Os filtros valem para o mapa e para a tabela ao mesmo tempo. Clique em um círculo para filtrar a tabela por aquele local.</p>
      <Explorador inicial={qs} />
    </main>
  );
}
