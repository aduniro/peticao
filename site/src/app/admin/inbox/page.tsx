import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import Inbox from "@/components/admin/Inbox";
export const dynamic = "force-dynamic";
export const metadata = { title: "Caixa de entrada", robots: { index: false } };
export default async function InboxPage() {
  const session = await sessaoAdmin();
  if (!session) redirect("/admin");
  if (!nivelOk(session.nivel, "edicao")) redirect("/admin?erro=nivel");
  if (!stepupValido(session)) redirect("/admin/confirmar?volta=%2Fadmin%2Finbox");
  return <main className="v2-pagina"><div className="v2-secao"><h1>Caixa de entrada</h1><Inbox /></div></main>;
}
