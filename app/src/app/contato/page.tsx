import AppBar from "@/components/AppBar";
import SiteFooter from "@/components/SiteFooter";
import ContactForm from "@/components/ContactForm";
import { getI18n } from "@/i18n/server";
import { turnstileEnabled, turnstileSiteKey } from "@/lib/turnstile";

export const dynamic = "force-dynamic";
export const metadata = { title: "Contato", robots: { index: false } };

export default async function Contato() {
  const { t } = await getI18n();
  return (
    <>
      <AppBar />
      <main className="narrow">
        <h1>{t("contact.title")}</h1>
        <p>{t("contact.intro")}</p>
        <ContactForm turnstileSiteKey={turnstileEnabled() ? turnstileSiteKey() : null} />
        <p><a href="/">{t("contact.back")}</a></p>
      </main>
      <SiteFooter />
    </>
  );
}
