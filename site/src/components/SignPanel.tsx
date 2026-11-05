"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

/** Painel de assinatura: coluna lateral no computador e folha deslizante (bottom sheet) no celular. */
export default function SignPanel({ children }: { children: React.ReactNode }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = (e: Event) => setOpen((e as CustomEvent).detail === "sign");
    const hash = () => { if (location.hash === "#assinar") setOpen(true); };
    window.addEventListener("peticao:open", on); window.addEventListener("hashchange", hash); hash();
    return () => { window.removeEventListener("peticao:open", on); window.removeEventListener("hashchange", hash); };
  }, []);
  useEffect(() => { document.body.classList.toggle("sheet-open", open); return () => document.body.classList.remove("sheet-open"); }, [open]);
  return (
    <>
      <div className={`scrim${open ? " on" : ""}`} onClick={() => setOpen(false)} aria-hidden="true" />
      <aside id="assinar" className={`panel${open ? " open" : ""}`} aria-label={t("form.title")}>
        <div className="sheet-handle" aria-hidden="true" />
        <button type="button" className="sheet-close" onClick={() => setOpen(false)} aria-label={t("sheet.close")}>×</button>
        {children}
      </aside>
    </>
  );
}
