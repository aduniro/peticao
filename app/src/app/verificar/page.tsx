import AppBar from "@/components/AppBar";
import SiteFooter from "@/components/SiteFooter";
import { getI18n } from "@/i18n/server";

export const metadata = { title: "Verificar assinatura", robots: { index: false, follow: false } };

export default async function VerificarInicio() {
  const { t } = await getI18n();
  return (
    <>
      <AppBar />
      <main className="narrow">
        <h1>{t("verify.title")}</h1>
        <p>{t("verify.intro")}</p>
        <form action="/verificar/ir" method="get" className="form">
          <label>{t("verify.code")}<input name="c" required minLength={10} maxLength={14} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCDE-FGHJK" /></label>
          <button className="primary">{t("verify.button")}</button>
        </form>
      </main>
      <SiteFooter />
    </>
  );
}
