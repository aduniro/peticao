import { isAdmin } from "@/lib/admin";
import { redirect } from "next/navigation";
import Explorador from "@/components/admin/Explorador";
import { filtrosParaQuery, parseFiltros } from "@/lib/assinaturas-explorar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mapa interativo", robots: { index: false } };

export default function Mapa({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!isAdmin()) redirect("/admin");
  const qs = filtrosParaQuery(parseFiltros(new URLSearchParams(Object.entries(searchParams).filter(([, v]) => typeof v === "string") as [string, string][])));
  return (
    <main className="v2-pagina v2-mapa-pagina">
      <Explorador inicial={qs} cheio />
    </main>
  );
}
