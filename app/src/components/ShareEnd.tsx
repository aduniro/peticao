"use client";
import { useEffect, useState } from "react";
import ShareButtons from "./ShareButtons";
import GovMail from "./GovMail";
import { shareTexts } from "@/content/compartilhar";
import { useI18n } from "@/i18n/client";

/** Seção de compartilhar no fim da página, com ícones e nomes (no computador os ícones ficam na barra superior). */
export default function ShareEnd() {
  const { t, lang, country } = useI18n();
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(location.origin), []);
  if (!origin) return <section className="sharebar share-end" aria-hidden="true" />;
  return (
    <section className="sharebar share-end" id="compartilhar" aria-labelledby="share-end-title">
      <h2 id="share-end-title">{t("share.title")}</h2>
      <p className="small">{t("share.hint")}</p>
      <ShareButtons link={origin} texts={shareTexts({ link: origin, locale: lang, country, cardUrl: `${origin}/api/cartao-compartilhar` })} />
      <GovMail />
    </section>
  );
}
