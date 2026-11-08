import { getI18n } from "@/i18n/server";

/** Rodapé das páginas públicas: contato, privacidade e a organização. */
export default async function SiteFooter() {
  const { t } = await getI18n();
  return (
    <footer className="small site-footer">
      <a href="/privacidade">{t("footer.privacy")}</a> · <a href="/contato">{t("footer.contact")}</a> · <a href="/verificar">{t("footer.verify")}</a> · {t("footer.org")}
    </footer>
  );
}
