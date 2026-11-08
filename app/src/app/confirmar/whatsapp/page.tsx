import AppBar from "@/components/AppBar";
import SiteFooter from "@/components/SiteFooter";
import WhatsappConfirm from "@/components/WhatsappConfirm";
import { getI18n } from "@/i18n/server";
import { counts } from "@/lib/signatures";
import { recentSignatures } from "@/lib/public-feed";
import { whatsappAtivo } from "@/lib/whatsapp/provider";
import { pendentePorToken } from "@/lib/whatsapp/store";
import { notFound } from "next/navigation";

export const metadata = { title: "Confirmar assinatura pelo WhatsApp", robots: { index: false } };
export const dynamic = "force-dynamic";

/** Cópia da página de confirmação por e-mail, com a conferência extra de identidade. Inexistente (404) enquanto o WhatsApp estiver desligado. */
export default async function ConfirmarWhatsapp({ searchParams }: { searchParams: { token?: string } }) {
  if (!whatsappAtivo()) notFound();
  const token = searchParams.token ?? "";
  const { t } = await getI18n();
  const pend = token ? await pendentePorToken(token) : null;
  return (
    <>
      <AppBar initial={{ counts: await counts(), items: await recentSignatures(8) }} />
      <main className="narrow">
        <h1>{t("wac.title")}</h1>
        {pend ? <WhatsappConfirm token={token} foreign={pend.category === "estrangeiro"} /> : <p>{t("wac.invalid")}</p>}
        <p><a href="/">{t("confirm.back")}</a></p>
      </main>
      <SiteFooter />
    </>
  );
}
