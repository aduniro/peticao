import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk } from "@/lib/admin-users";
import { mailDeliverySearch, mailDeliveryQuery } from "@/lib/mail-delivery-admin-contract";
import { readMailDeliveryPage } from "@/lib/mail-delivery-admin-store";
import EntregasConsulta from "@/components/admin/EntregasConsulta";

export const dynamic = "force-dynamic";

export default async function Entregas({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const session = await sessaoAdmin();
  if (!session) redirect("/admin");
  if (!nivelOk(session.nivel, "edicao")) redirect("/admin?erro=nivel");
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) for (const part of value) params.append(key, part);
    else if (value !== undefined) params.append(key, value);
  }
  const parsed = mailDeliverySearch(params);
  const options = parsed.ok && parsed.format === "json" ? parsed.options : null;
  const result = options ? await readMailDeliveryPage(session, options) : null;
  // Recheck the actor after the complete read, before serializing contact data.
  const current = await sessaoAdmin();
  if (!current || current.userId !== session.userId || current.sessaoId !== session.sessaoId || !nivelOk(current.nivel, "edicao")) redirect("/admin?erro=nivel");
  if (current.nivel !== session.nivel) redirect("/admin/emails/entregas");
  const actorScope = `${current.userId}:${current.sessaoId ?? "legacy"}:${current.nivel}`;
  const initialQuery = options ? mailDeliveryQuery(options) : params.toString();
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
        <p><a href="/admin/emails">← E-mails</a></p>
        {/* MUDAR AQUI: a unidade inclui cadastros e endereços avulsos; não equivale a pessoas ou mensagens únicas. */}
        <h1>Entregas e sinais registrados</h1>
        <EntregasConsulta actorScope={actorScope} initial={result?.ok ? result : null} initialError={!options ? "invalid" : result?.ok ? undefined : result?.error ?? "unavailable"} initialQuery={initialQuery} />
      </div>
    </main>
  );
}
