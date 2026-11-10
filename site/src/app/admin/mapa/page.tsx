import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { redirect } from "next/navigation";
import Explorador from "@/components/admin/Explorador";
import { filtrosParaQuery, parseFiltros } from "@/lib/assinaturas-explorar";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mapa interativo", robots: { index: false } };

export default async function Mapa({ searchParams }: { searchParams: Record<string, string | undefined> }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "leitura")) redirect("/admin?erro=nivel");
  const qs = filtrosParaQuery(parseFiltros(new URLSearchParams(Object.entries(searchParams).filter(([, v]) => typeof v === "string") as [string, string][])));
  return (
    <main className="v2-pagina v2-mapa-pagina">
      <Explorador actorScope={`${sessao.userId}:${sessao.sessaoId ?? "legacy"}:${sessao.nivel}`} inicial={qs} cheio />
    </main>
  );
}
