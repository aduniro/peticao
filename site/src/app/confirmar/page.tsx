import ConfirmButton from "@/components/ConfirmButton";
import AppBar from "@/components/AppBar";
import SiteFooter from "@/components/SiteFooter";
import { getI18n } from "@/i18n/server";
import { counts } from "@/lib/signatures";
import { recentSignatures } from "@/lib/public-feed";

export const metadata = { title: "Confirmar assinatura", robots: { index: false } };

export default async function Confirmar({ searchParams }: { searchParams: { token?: string } }) {
  const token = searchParams.token ?? "";
  const { t } = await getI18n();
  return (
    <>
    <AppBar initial={{ counts: await counts(), items: await recentSignatures(8) }} />
    <main className="narrow">
      <h1>{t("confirm.title")}</h1>
      {token ? (
        <>
          <p>{t("confirm.text")}</p>
          <ConfirmButton token={token} />
        </>
      ) : (
        <p>{t("confirm.incomplete")}</p>
      )}
      <p><a href="/">{t("confirm.back")}</a></p>
    </main>
      <SiteFooter />
    </>
  );
}
