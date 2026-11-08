"use client";
import { useEffect, useState } from "react";
import ThemeToggle from "./ThemeToggle";
import LangSwitcher from "./LangSwitcher";
import ShareButtons from "./ShareButtons";
import { shareTexts } from "@/content/compartilhar";
import { useI18n } from "@/i18n/client";
import { useLive, type LiveData } from "@/lib/live-client";

function LiveCount({ initial }: { initial: LiveData }) {
  const { t } = useI18n();
  const n = useLive(initial).counts.total;
  return <>{n} {t(n === 1 ? "stats.signatures.one" : "stats.signatures.other")}</>;
}

/** Ícones de compartilhar na barra superior (só no computador; no celular vale a aba "Compartilhar"). */
function TopShare() {
  const { lang, country } = useI18n();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  if (!origin) return null;
  return <div className="appbar-share"><ShareButtons variant="icons" link={origin} texts={shareTexts({ link: origin, locale: lang, country, cardUrl: `${origin}/api/cartao-compartilhar` })} /></div>;
}

export default function AppBar({ initial, share = false }: { initial?: LiveData; share?: boolean }) {
  const { t } = useI18n();
  const open = (what: string) => window.dispatchEvent(new CustomEvent("peticao:open", { detail: what }));
  return (
    <header className="appbar">
      <a className="brand" href="/" aria-label="PLV 12/2026">
        <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><rect width="24" height="24" rx="6" fill="#fff" opacity=".18" /><path d="M7 12.5l3.2 3.2L17 8.8" fill="none" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span><strong>PLV 12/2026</strong><small>{initial ? <LiveCount initial={initial} /> : t("brand.org")}</small></span>
      </a>
      {share && <TopShare />}
      <span className="appbar-actions">
        <a className="appbar-btn" href="/contato" aria-label={t("footer.contact")} title={t("footer.contact")} data-track="appbar-contato">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.5l8 5 8-5V6H4zm16 3-8 5-8-5v9h16V9z" /></svg>
        </a>
        <LangSwitcher /><ThemeToggle />
        <button type="button" className={`appbar-btn${share ? " share-open" : ""}`} onClick={() => open("share")} aria-label={t("appbar.share")} data-track="appbar-compartilhar">
          <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M18 16a3 3 0 0 0-2.4 1.200L8.900 13.300a3 3 0 0 0 0-2.600l6.700-3.900A3 3 0 1 0 15 5.600L8.400 9.500a3 3 0 1 0 0 5l6.600 3.900A3 3 0 1 0 18 16z" /></svg>
        </button>
      </span>
    </header>
  );
}
