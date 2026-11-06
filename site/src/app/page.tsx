import { PETICAO_BR, PETICAO_EST, ORGANIZER, TEXT_VERSION } from "@/content/peticao";
import { counts } from "@/lib/signatures";
import { recentSignatures } from "@/lib/public-feed";
import { config } from "@/lib/config";
import { whatsappAtivo } from "@/lib/whatsapp/provider";
import { turnstileEnabled, turnstileSiteKey } from "@/lib/turnstile";
import { getI18n } from "@/i18n/server";
import { LOCALE_INFO } from "@/i18n";
import SignForm from "@/components/SignForm";
import SignPanel from "@/components/SignPanel";
import AppBar from "@/components/AppBar";
import HeroActions from "@/components/HeroActions";
import CoverCarousel from "@/components/CoverCarousel";
import LiveStats from "@/components/LiveStats";
import LiveFeed from "@/components/LiveFeed";
import GoalBar from "@/components/GoalBar";
import ShareEnd from "@/components/ShareEnd";
import SiteFooter from "@/components/SiteFooter";
import Logos from "@/components/Logos";
import WelcomeModal from "@/components/WelcomeModal";
import PetitionDoc from "@/components/PetitionDoc";

export const dynamic = "force-dynamic";

export default async function Home() {
  const { lang, t } = await getI18n();
  const initial = { counts: await counts(), items: await recentSignatures(8) };
  const goal = config.goal(), batch = config.batchSize();
  const finalLabel = new Intl.DateTimeFormat(LOCALE_INFO[lang].intl, { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(config.finalAt());
  const br = PETICAO_BR[lang], est = PETICAO_EST[lang];
  return (
    <>
      <AppBar initial={initial} share />
      <WelcomeModal goal={goal} batch={batch} finalLabel={finalLabel} />
      <main className="home">
        <CoverCarousel choice={config.coverChoice()} />
        <section className="hero">
          <span className="pill">{t("hero.pill")}</span>
          <h1>{br.title}</h1>
          <p className="org">{ORGANIZER}</p>
          <LiveStats initial={initial} />
          <GoalBar initial={initial} goal={goal} batch={batch} />
          <HeroActions />
        </section>
        <div className="layout">
          <PetitionDoc br={br} est={est} version={TEXT_VERSION.slice(0, 12)} />
          <div className="side">
            <LiveFeed initial={initial} />
            <SignPanel>
              <SignForm consentBr={br.consentBr} consentForeign={est.consentForeign} turnstileSiteKey={turnstileEnabled() ? turnstileSiteKey() : null} whatsappAtivo={whatsappAtivo()} />
              {process.env.SUBSCRIBER_ACCESS_ENABLED === "1" && <p className="small"><a href="/minha-assinatura">Verificar/Corrigir minha assinatura</a></p>}
            </SignPanel>
          </div>
        </div>
        <ShareEnd />
        <Logos />
        <SiteFooter />
      </main>
    </>
  );
}
