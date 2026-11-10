import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { listDispersionData } from "@/lib/dispersion-admin-store";
import DispersaoConsulta from "@/components/admin/DispersaoConsulta";
export const dynamic = "force-dynamic";
export const metadata = { title: "Dispersão da campanha", robots: { index: false } };
export default async function Dispersao() {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "edicao")) redirect("/admin?erro=nivel");
  const data = await listDispersionData(sessao, { view: "all", limit: 50 });
  const scope = `${sessao.userId}:${sessao.sessaoId ?? "legacy"}`;
  return <main className="v2-pagina"><div className="v2-secao">
    <p><a href="/admin/indicacoes">Indicações</a> · <a href="/admin/monitor">Monitor</a></p>
    <h1>Dispersão da campanha</h1>
    <DispersaoConsulta key={scope} actorScope={scope} initial={data.ok ? data : null} initialError={data.ok ? undefined : data.error} />
  </div></main>;
}
