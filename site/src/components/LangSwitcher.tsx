"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LOCALES, LOCALE_INFO, type Locale } from "@/i18n";
import { useI18n } from "@/i18n/client";

/** Seletor de idioma com bandeiras. O idioma é independente do país escolhido no formulário. */
export default function LangSwitcher() {
  const { lang, t } = useI18n();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", off); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", off); document.removeEventListener("keydown", esc); };
  }, []);
  const choose = (l: Locale) => {
    document.cookie = `lang=${l}; path=/; max-age=31536000; samesite=lax`;
    setOpen(false);
    router.refresh();
  };
  return (
    <span className="lang" ref={box}>
      <button type="button" className="appbar-btn" aria-haspopup="listbox" aria-expanded={open} aria-label={`${t("lang.label")}: ${LOCALE_INFO[lang].name}`} onClick={() => setOpen((o) => !o)} data-track="idioma">
        <img src={`/flags/${LOCALE_INFO[lang].flag}.svg`} alt="" width={22} height={16} /><span className="lang-code">{lang.toUpperCase()}</span>
      </button>
      {open && (
        <ul role="listbox" className="lang-list" aria-label={t("lang.label")}>
          {LOCALES.map((l) => (
            <li key={l} role="option" aria-selected={l === lang}>
              <button type="button" className={l === lang ? "on" : ""} lang={l} onClick={() => choose(l)} data-track={`idioma-${l}`}>
                <img src={`/flags/${LOCALE_INFO[l].flag}.svg`} alt="" width={22} height={16} />{LOCALE_INFO[l].name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  );
}
