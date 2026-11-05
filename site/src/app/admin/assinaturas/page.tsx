import { isAdmin } from "@/lib/admin";
import { redirect } from "next/navigation";
import Explorador from "@/components/admin/Explorador";
import { filtrosParaQuery, parseFiltros } from "@/lib/assinaturas-explorar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Assinaturas", robots: { index: false } };

export default function Assinaturas({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!isAdmin()) redirect("/admin");
  const qs = filtrosParaQuery(parseFiltros(new URLSearchParams(Object.entries(searchParams).filter(([, v]) => typeof v === "string") as [string, string][])));
  return (
    <main className="adm-page">
      <h1>Assinaturas</h1>
      <p className="adm-sub">Busque, filtre, ordene e baixe a lista. Para ver no mapa, use o botão “Ver estes filtros no mapa”.</p>
      <Explorador inicial={qs} />
    </main>
  );
}
