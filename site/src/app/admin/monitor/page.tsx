import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/admin";
import { geoDbStatus } from "@/lib/geo";
import MonitorClient from "@/components/MonitorClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monitor de acessos", robots: { index: false } };

export default async function Monitor() {
  if (!isAdmin()) redirect("/admin");
  const geo = await geoDbStatus();
  return (
    <main className="wide">
      <p><a href="/admin">← Painel</a> · <a href="/admin/indicacoes">Indicações</a></p>
      <h1>Monitor de acessos</h1>
      {!geo.city && <p className="box">A base de geolocalização não foi encontrada em <code>geo-data/</code>: o mapa fica vazio. Rode <code>scripts/update-geo-db.sh</code>.</p>}
      <MonitorClient />
      <p className="small">Localização aproximada por IP (base offline DB-IP Lite, CC BY 4.0: <a href="https://db-ip.com" target="_blank" rel="noreferrer noopener">IP Geolocation by DB-IP</a>). Cidade e provedor podem estar errados (VPN, redes móveis).
        Visitantes que ativam Do Not Track ou Global Privacy Control não são registrados. Registros são apagados após {process.env.EVENT_RETENTION_DAYS ?? 90} dias.</p>
    </main>
  );
}
