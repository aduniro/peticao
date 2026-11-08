"use client";
import { useEffect, useRef, useState } from "react";
import { govMailto } from "@/content/governo";
import { useI18n } from "@/i18n/client";

/** Botão "Escrever ao Governo": copia o cartão em tópicos (para colar no e-mail) e abre o e-mail do usuário com todos os destinatários em cópia oculta. */
export default function GovMail({ compact = false }: { compact?: boolean }) {
  const { t } = useI18n();
  const [msg, setMsg] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>();
  useEffect(() => () => clearTimeout(timer.current), []);
  const flash = (m: string) => { setMsg(m); clearTimeout(timer.current); timer.current = setTimeout(() => setMsg(""), 7000); };
  async function write() {
    const origin = location.origin, cardUrl = `${origin}/api/cartao-governo`;
    // A cópia do cartão é pedida dentro do clique (com a imagem como Promise): Safari/Chrome exigem o gesto do usuário.
    let copying: Promise<boolean> = Promise.resolve(false);
    if (navigator.clipboard && "ClipboardItem" in window) {
      try { copying = navigator.clipboard.write([new ClipboardItem({ "image/png": fetch(cardUrl).then((r) => r.blob()) })]).then(() => true, () => false); } catch { /* sem permissão */ }
    }
    flash(t("gov.copied"));
    // Espera a cópia terminar (até 1,2 s) ANTES de abrir o e-mail: no Android a página perde o foco na hora em que o e-mail abre e a cópia falharia.
    const ok = await Promise.race([copying, new Promise<boolean>((r) => setTimeout(() => r(false), 1200))]);
    if (!ok) flash(t("gov.copyFail"));
    window.location.href = govMailto({ link: origin, cardUrl });
  }
  return (
    <div className={`govmail${compact ? " compact" : ""}`} data-tour="gov">
      <button type="button" className="btn gov" onClick={write} data-track="governo-email" data-event="share">
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.5l8 5 8-5V6H4zm16 3-8 5-8-5v9h16V9z" /></svg>
        {t("gov.button")}
      </button>
      {!compact && <a className="btn" href="/api/cartao-governo?baixar=1" download="pedido-ao-governo-plv12.png" data-track="governo-cartao">{t("gov.download")}</a>}
      {!compact && <p className="small">{t("gov.hint")}</p>}
      {msg && <p className="small" role="status">{msg}</p>}
    </div>
  );
}
