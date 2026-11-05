"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";

/** Botão "Como usar": pergunta (janela) se a pessoa quer o tour; "Sim" refaz o tour da categoria aberta. */
export default function HowTo({ onYes }: { onYes: () => void }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (typeof d.showModal !== "function") { d.classList.add("fallback"); if (open) d.setAttribute("open", ""); else d.removeAttribute("open"); return; }
    if (open && !d.open) d.showModal(); if (!open && d.open) d.close();
  }, [open]);
  return (
    <>
      <button type="button" className="howto-btn" onClick={() => setOpen(true)} data-track="como-usar">
        <span className="howto-q" aria-hidden="true">?</span>{t("tour.how")}
      </button>
      <dialog ref={ref} className="modal howto" aria-labelledby="ht-title" onClose={() => setOpen(false)} onClick={(e) => { if (e.target === ref.current) setOpen(false); }}>
        <div>
          <h2 id="ht-title">{t("tour.ask.title")}</h2>
          <p>{t("tour.ask.text")}</p>
          <div className="modal-actions">
            <button type="button" className="ghost" onClick={() => setOpen(false)} data-track="tour-nao">{t("tour.no")}</button>
            <button type="button" onClick={() => { setOpen(false); setTimeout(onYes, 250); }} data-track="tour-sim">{t("tour.yes")}</button>
          </div>
        </div>
      </dialog>
    </>
  );
}
