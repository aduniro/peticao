"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";

/** Janela de entrada (primeira visita): a meta, os envios a cada 500 assinaturas e a data da versão final. */
export default function WelcomeModal({ goal, batch, finalLabel }: { goal: number; batch: number; finalLabel: string }) {
  const { t, lang } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (location.pathname !== "/" || location.hash === "#assinar") return;
    try { if (localStorage.getItem("welcome1")) return; } catch { /* sem armazenamento: mostra */ }
    setOpen(true);
  }, []);
  useEffect(() => {
    const d = ref.current; if (!d || !open) return;
    if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else { d.classList.add("fallback"); d.setAttribute("open", ""); }
  }, [open]);
  const nf = new Intl.NumberFormat(lang === "pt" ? "pt-BR" : lang);
  const close = (sign: boolean) => {
    try { localStorage.setItem("welcome1", "1"); } catch { /* ok */ }
    setOpen(false); ref.current?.close();
    window.dispatchEvent(new CustomEvent("peticao:welcome-closed")); // o tour só começa depois desta janela
    if (sign) { window.dispatchEvent(new CustomEvent("peticao:open", { detail: "sign" })); if (window.innerWidth >= 900) document.getElementById("assinar")?.scrollIntoView({ behavior: "smooth", block: "start" }); }
  };
  if (!open) return null;
  const v = { goal: nf.format(goal), batch: nf.format(batch), final: finalLabel };
  return (
    <dialog ref={ref} className="modal welcome" aria-labelledby="wm-title" onCancel={() => close(false)} onClick={(e) => { if (e.target === ref.current) close(false); }}>
      <div>
        <h2 id="wm-title">{t("welcome.title", v)}</h2>
        <p><strong>{t("welcome.p1", v)}</strong></p>
        <p>{t("welcome.p2", v)}</p>
        <p>{t("welcome.p3", v)}</p>
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={() => close(false)} data-track="boasvindas-fechar">{t("welcome.close")}</button>
          <button type="button" onClick={() => close(true)} data-track="boasvindas-assinar">{t("welcome.cta")}</button>
        </div>
      </div>
    </dialog>
  );
}
