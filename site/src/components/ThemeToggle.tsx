"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

/** Tema claro por padrão; a escolha da pessoa fica guardada neste aparelho. */
export default function ThemeToggle() {
  const { t } = useI18n();
  const [dark, setDark] = useState(false);
  useEffect(() => { setDark(document.documentElement.dataset.theme === "dark"); }, []);
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.dataset.theme = next ? "dark" : "light";
    try { localStorage.setItem("theme", next ? "dark" : "light"); } catch { /* sem armazenamento */ }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", next ? "#04281d" : "#0b6b45");
  };
  return (
    <button type="button" className="appbar-btn" onClick={toggle} aria-label={dark ? t("theme.light") : t("theme.dark")} aria-pressed={dark} data-track="tema">
      {dark
        ? <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M12 7a5 5 0 1 0 0 10 5 5 0 0 0 0-10zM11 1h2v3h-2V1zm0 19h2v3h-2v-3zM3.500 4.900l1.400-1.400 2.100 2.100-1.400 1.400-2.100-2.100zm13.500 13.500 1.400-1.400 2.100 2.100-1.400 1.400-2.100-2.100zM1 11h3v2H1v-2zm19 0h3v2h-3v-2zM4.900 20.500l-1.400-1.400 2.100-2.100 1.400 1.400-2.100 2.100zM19 6.100l-1.400-1.400L19.700 2.600l1.400 1.400L19 6.100z" /></svg>
        : <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path fill="currentColor" d="M21 12.800A9 9 0 1 1 11.200 3a7 7 0 0 0 9.800 9.800z" /></svg>}
    </button>
  );
}
