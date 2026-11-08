"use client";
import { useEffect, useState } from "react";
import ShareButtons from "./ShareButtons";
import GovMail from "./GovMail";
import { shareTexts } from "@/content/compartilhar";
import { useI18n } from "@/i18n/client";

/** Folha "Compartilhar" (celular): divulga o link geral; o cartaz com QR pessoal vem depois da assinatura confirmada. */
export default function ShareSheet() {
  const { t, lang, country } = useI18n();
  const [open, setOpen] = useState(false);
  const [origin, setOrigin] = useState("");
  useEffect(() => {
    setOrigin(location.origin);
    const on = (e: Event) => setOpen((e as CustomEvent).detail === "share");
    window.addEventListener("peticao:open", on);
    return () => window.removeEventListener("peticao:open", on);
  }, []);
  if (!origin) return null;
  const texts = shareTexts({ link: origin, locale: lang, country, cardUrl: `${origin}/api/cartao-compartilhar` });
  return (
    <>
      <div className={`scrim share-scrim${open ? " on" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside className={`panel share-panel${open ? " open" : ""}`} aria-label={t("appbar.share")}>
        <div className="sheet-handle" aria-hidden="true" />
        <button type="button" className="sheet-close" onClick={() => setOpen(false)} aria-label={t("sheet.close")}>×</button>
        <h2 className="form-title">{t("share.title")}</h2>
        <p className="small">{t("share.hint")}</p>
        <ShareButtons link={origin} texts={texts} />
        <GovMail />
      </aside>
    </>
  );
}
