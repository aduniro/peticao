import { readFileSync } from "node:fs";
import { join } from "node:path";
import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import Rankings from "@/components/admin/Rankings";

export const dynamic = "force-dynamic";
export const metadata = { title: "Rankings", robots: { index: false } };

export default async function RankingsPagina({ searchParams }: { searchParams: { uf?: string } }) {
  const s = await sessaoAdmin();
  if (!s) redirect("/admin");
  if (!nivelOk(s.nivel, "leitura")) redirect("/admin?erro=nivel");
  const svg = JSON.parse(readFileSync(join(process.cwd(), "public", "data", "geo", "brasil-svg.json"), "utf8")) as { ufs: Record<string, { nome: string }> };
  const ufs = Object.entries(svg.ufs).map(([uf, d]) => ({ v: uf, rotulo: `${d.nome} (${uf})` })).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt"));
  const ufInicial = (searchParams.uf ?? "").split(",").map((x) => x.trim().toUpperCase()).filter((x) => svg.ufs[x]);
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
      <h1>Rankings</h1>
      <p className="v2-sub">Servidores por IFES e por campus (docentes, técnicos e não declarados), apoiadores da sociedade civil por estado e cidade, e estrangeiros por país e universidade. Só contagens: nenhum nome, e-mail ou CPF.</p>
      <Rankings ufs={ufs} ufInicial={ufInicial} />
      </div>
    </main>
  );
}
