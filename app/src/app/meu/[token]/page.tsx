import { notFound } from "next/navigation";
import { referrerByToken, referrerStats } from "@/lib/referrals";
import { shareTexts } from "@/content/compartilhar";
import { config } from "@/lib/config";
import ShareButtons from "@/components/ShareButtons";
import AppBar from "@/components/AppBar";
import SiteFooter from "@/components/SiteFooter";
import { getI18n } from "@/i18n/server";
import LiveTotal from "@/components/LiveTotal";
import { counts } from "@/lib/signatures";
import { recentSignatures } from "@/lib/public-feed";

export const dynamic = "force-dynamic";
export const metadata = { title: "Meu cartaz para compartilhar", robots: { index: false, follow: false } };

export default async function Meu({ params }: { params: { token: string } }) {
  const ref = await referrerByToken(params.token);
  if (!ref) notFound();
  const stats = await referrerStats(ref.code);
  const { t, lang, country } = await getI18n();
  const initial = { counts: await counts(), items: await recentSignatures(8) };
  const base = config.appUrl().replace(/\/$/, "");
  const link = `${base}/r/${ref.code}`;
  const texts = shareTexts({ link, firstName: ref.display_name, locale: lang, country, cardUrl: `${base}/api/cartaz/${ref.code}` });
  return (
    <>
    <AppBar initial={initial} />
    <main className="narrow">
      <h1>{t("my.thanks")}{ref.display_name ? `, ${ref.display_name}` : ""}!</h1>
      <p>{t("my.intro")}</p>
      <LiveTotal initial={initial} />
      <div className="stats" aria-label="Stats">
        <div><strong>{stats.visits}</strong><span>{t("my.visits")}</span></div>
        <div><strong>{stats.signed}</strong><span>{t("my.signed")}</span></div>
        <div><strong>{stats.pending}</strong><span>{t("my.pending")}</span></div>
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="card-img" src={`/api/cartaz/${ref.code}`} alt={t("my.cardAlt")} width={540} height={936} />
      <ShareButtons link={link} cardUrl={`/api/cartaz/${ref.code}`} cardName={`cartaz-plv12-${ref.code}.png`} texts={texts} />
      <p className="small">{t("my.footnote")}</p>
    </main>
      <SiteFooter />
    </>
  );
}
