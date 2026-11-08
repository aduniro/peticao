"use client";
import { useI18n } from "@/i18n/client";
import GovMail from "./GovMail";

export default function HeroActions() {
  const { t } = useI18n();
  const sign = () => {
    window.dispatchEvent(new CustomEvent("peticao:open", { detail: "sign" }));
    if (window.innerWidth >= 900) document.getElementById("assinar")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };
  return (
    <div className="hero-cta">
      <button type="button" className="primary" onClick={sign} data-track="hero-assinar">{t("hero.sign")}</button>
      <button type="button" className="ghost-light hero-share" onClick={() => window.dispatchEvent(new CustomEvent("peticao:open", { detail: "share" }))} data-track="hero-compartilhar">{t("hero.share")}</button>
      <span className="hero-gov"><GovMail compact /></span>
    </div>
  );
}
