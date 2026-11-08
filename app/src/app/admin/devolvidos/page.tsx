import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

/** A lista passou a fazer parte do painel de e-mails (agora com as devoluções de todos os provedores). */
export default function Devolvidos() {
  redirect("/admin/emails#pendentes");
}
