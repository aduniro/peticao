"use client";
import { useEffect, useId, useRef } from "react";

/** Janela de aviso (dialog nativo, vira folha no celular): título, texto e um botão. */
/** Destaca a palavra "spam" (qualquer idioma) em caixa alta e vermelho, para a pessoa lembrar de olhar essa pasta. */
export function Spammy({ text }: { text: string }) {
  return <>{text.split(/(spam)/i).map((part, i) => (/^spam$/i.test(part) ? <strong key={i} className="spam-word">SPAM</strong> : part))}</>;
}

export default function NoticeModal({ open, title, text, ok, onClose, tone = "info" }: { open: boolean; title: string; text: string; ok: string; onClose: () => void; tone?: "info" | "error" }) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const textId = useId();
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open) { if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else { d.classList.add("fallback"); d.setAttribute("open", ""); } }
    else if (d.open) { if (typeof d.close === "function") d.close(); else d.removeAttribute("open"); }
  }, [open]);
  return (
    <dialog ref={ref} className={`modal notice ${tone}`} role={tone === "error" ? "alertdialog" : "dialog"} aria-labelledby={titleId} aria-describedby={textId} onCancel={(e) => { e.preventDefault(); onClose(); }} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="notice-body">
        <h2 id={titleId}>{title}</h2>
        <p id={textId}><Spammy text={text} /></p>
        <div className="modal-actions"><button type="button" className="primary" onClick={onClose} autoFocus>{ok}</button></div>
      </div>
    </dialog>
  );
}
