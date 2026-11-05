"use client";
import { useEffect, useRef } from "react";

/** Janela de aviso (dialog nativo, vira folha no celular): título, texto e um botão. */
/** Destaca a palavra "spam" (qualquer idioma) em caixa alta e vermelho, para a pessoa lembrar de olhar essa pasta. */
export function Spammy({ text }: { text: string }) {
  return <>{text.split(/(spam)/i).map((part, i) => (/^spam$/i.test(part) ? <strong key={i} className="spam-word">SPAM</strong> : part))}</>;
}

export default function NoticeModal({ open, title, text, ok, onClose, tone = "info" }: { open: boolean; title: string; text: string; ok: string; onClose: () => void; tone?: "info" | "error" }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current; if (!d) return;
    if (open) { if (typeof d.showModal === "function") { if (!d.open) d.showModal(); } else { d.classList.add("fallback"); d.setAttribute("open", ""); } }
    else if (d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`modal notice ${tone}`} aria-labelledby="nm-title" onCancel={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="notice-body" role={tone === "error" ? "alertdialog" : undefined}>
        <h2 id="nm-title">{title}</h2>
        <p><Spammy text={text} /></p>
        <div className="modal-actions"><button type="button" className="primary" onClick={onClose} autoFocus>{ok}</button></div>
      </div>
    </dialog>
  );
}
