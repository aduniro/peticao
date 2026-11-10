import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { listReferralAdminStats } from "@/lib/referral-admin-stats-store";
import { config } from "@/lib/config";
import { randomUUID } from "node:crypto";
import CriarIndicacao from "@/components/admin/CriarIndicacao";
import IndicacoesConsulta from "@/components/admin/IndicacoesConsulta";
import IndicacoesGestao from "@/components/admin/IndicacoesGestao";

export const dynamic = "force-dynamic";
export const metadata = { title: "Indicações", robots: { index: false } };

export default async function Indicacoes({ searchParams }: { searchParams: { msg?: string; completedRequestId?: string } }) {
  const sessao = await sessaoAdmin();
  if (!sessao) redirect("/admin");
  if (!nivelOk(sessao.nivel, "leitura")) redirect("/admin?erro=nivel");
  const stats = await listReferralAdminStats(sessao, { limit: 50 });
  const scope = `${sessao.userId}:${sessao.sessaoId ?? "legacy"}`;
  const base = config.appUrl().replace(/\/$/, "");
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
        <p><a href="/admin/monitor">Monitor de acessos</a></p>
        <h1>Indicações e links pessoais</h1>
        {searchParams.msg && <p className="box ok" role="status">{searchParams.msg}</p>}
        {nivelOk(sessao.nivel, "edicao") && <CriarIndicacao scope={scope} initialRequestId={randomUUID()} completedRequestId={searchParams.completedRequestId} />}
        <IndicacoesConsulta key={`consulta:${scope}`} actorScope={scope} appBase={base} initial={stats.ok ? stats : null} initialError={stats.ok ? undefined : stats.error} />
        {nivelOk(sessao.nivel, "edicao") && <IndicacoesGestao key={`gestao:${scope}`} actorScope={scope} canArchive={nivelOk(sessao.nivel, "exclusao")} />}
      </div>
    </main>
  );
}
