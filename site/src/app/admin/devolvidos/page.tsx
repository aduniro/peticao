import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";

export const dynamic = "force-dynamic";

/** A lista passou a fazer parte do painel de e-mails (agora com as devoluções de todos os provedores). */
export default async function Devolvidos() {
  await sessaoAdmin();
  redirect("/admin/emails#pendentes");
}
