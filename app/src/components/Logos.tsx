import { getI18n } from "@/i18n/server";

/** Selo da organização: logos da ADUNIR e do ANDES-SN com a frase de iniciativa (legitima a campanha). */
export default async function Logos() {
  const { t } = await getI18n();
  return (
    <section className="logos" aria-label={t("brand.initiative")}>
      <p className="small">{t("brand.initiative")}</p>
      <div className="logos-row">
        <img src="/logos/adunir.png" alt="ADUNIR" width={383} height={102} loading="lazy" />
        <span className="logos-sep" aria-hidden="true" />
        <img src="/logos/andes.png" alt="ANDES-SN – Sindicato Nacional" width={442} height={300} loading="lazy" />
      </div>
    </section>
  );
}
