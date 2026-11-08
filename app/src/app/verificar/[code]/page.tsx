import { headers } from "next/headers";
import AppBar from "@/components/AppBar";
import SiteFooter from "@/components/SiteFooter";
import { getI18n } from "@/i18n/server";
import { lookupSignature } from "@/lib/verify";
import { formatCode } from "@/lib/verify-code";
import { brasilia } from "@/lib/time";
import { rateLimit } from "@/lib/ratelimit";
import { clientIp } from "@/lib/net";

export const dynamic = "force-dynamic";
export const metadata = { title: "Verificação de assinatura", robots: { index: false, follow: false } };

export default async function Verificar({ params }: { params: { code: string } }) {
  const { t } = await getI18n();
  const ip = clientIp(headers());
  const allowed = rateLimit(`verify:${ip}`, 60, 10 * 60_000);
  const sig = allowed ? await lookupSignature(decodeURIComponent(params.code)) : null;
  const role = sig?.role === "docente" ? t("f.roleDocente") : sig?.role === "tae" ? t("f.roleTae") : null;
  return (
    <>
      <AppBar />
      <main className="narrow">
        <h1>{t("verify.title")}</h1>
        {!allowed ? <p className="box" role="alert">{t("verify.rate")}</p> : sig ? (
          <div className="box ok verify-card" role="status">
            <h2>{t("verify.valid")}</h2>
            <dl className="verify-dl">
              <dt>{t("verify.number")}</dt><dd>{sig.seq}</dd>
              <dt>{t("verify.name")}</dt><dd><strong>{sig.name}</strong></dd>
              {sig.category === "servidor" && <><dt>{t("verify.institution")}</dt><dd>{sig.institution}</dd></>}
              {role && <><dt>{t("verify.role")}</dt><dd>{role}</dd></>}
              {sig.lotado && <><dt>{t("f.campus")}</dt><dd>{sig.lotado}</dd></>}
              {sig.category === "apoiador" && sig.city && <><dt>{t("verify.place")}</dt><dd>{sig.city}{sig.uf ? `/${sig.uf}` : ""}</dd></>}
              {sig.category === "estrangeiro" && <><dt>{t("verify.institution")}</dt><dd>{sig.university}{sig.country ? ` (${sig.country})` : ""}</dd></>}
              <dt>{t("verify.date")}</dt><dd>{brasilia(sig.confirmed_at, true)}</dd>
              <dt>{t("verify.cpf")}</dt><dd>{sig.cpf_name_check === "match" ? t("verify.cpfYes") : t("verify.cpfNo")}</dd>
              <dt>{t("verify.code")}</dt><dd><code>{formatCode(sig.code)}</code></dd>
            </dl>
            <p className="small">{t("verify.note")}</p>
          </div>
        ) : <p className="box" role="alert">{t("verify.notFound")}</p>}
        <p><a href="/verificar">{t("verify.another")}</a></p>
      </main>
      <SiteFooter />
    </>
  );
}
