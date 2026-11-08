import { isAdmin } from "@/lib/admin";
import { redirect } from "next/navigation";
import Explorador from "@/components/admin/Explorador";
import { filtrosParaQuery, parseFiltros } from "@/lib/assinaturas-explorar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mapa — tela cheia", robots: { index: false } };

/** Janela própria só com filtros e mapa (sem o menu do painel). */
export default function Tela({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  if (!isAdmin()) redirect("/admin");
  const qs = filtrosParaQuery(parseFiltros(new URLSearchParams(Object.entries(searchParams).filter(([, v]) => typeof v === "string") as [string, string][])));
  return <main className="adm-page" style={{ padding: 8 }}><Explorador inicial={qs} tela /></main>;
}
