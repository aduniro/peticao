"use client";
import { useEffect, useRef, useState } from "react";
import DateField from "./DateField";
import MaskedInput, { nameMask } from "./MaskedInput";
import { useI18n } from "@/i18n/client";

export type IdentityMethod = "mae" | "nascimento";

export default function IdentityModal({ open, busy, error, attemptsLeft, locked, onClose, onConfirm }: {
  open: boolean; busy: boolean; error: string; attemptsLeft: number | null; locked: boolean; onClose: () => void; onConfirm: (m: IdentityMethod, value: string) => void;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const [method, setMethod] = useState<IdentityMethod>("nascimento");
  const [birth, setBirth] = useState("");
  const [mae, setMae] = useState("");

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (typeof d.showModal !== "function") { // navegadores antigos sem <dialog>: abre como camada fixa
      d.classList.add("fallback");
      if (open) d.setAttribute("open", ""); else d.removeAttribute("open");
      return;
    }
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const value = method === "nascimento" ? birth : mae;
  const submit = (e: React.FormEvent) => { e.preventDefault(); if (!busy && !locked) onConfirm(method, value); };

  return (
    <dialog ref={ref} className="modal" onClose={onClose} onClick={(e) => { if (e.target === ref.current) onClose(); }} aria-labelledby="idm-title">
      <form onSubmit={submit} autoComplete="off">
        <h2 id="idm-title">{t("id.title")}</h2>
        <p>{t("id.intro")}</p>
        <div className="segmented" role="radiogroup" aria-label={t("id.method")}>
          <button type="button" role="radio" aria-checked={method === "nascimento"} className={method === "nascimento" ? "on" : ""} data-track="identidade-nascimento" onClick={() => setMethod("nascimento")}>{t("id.birth")}</button>
          <button type="button" role="radio" aria-checked={method === "mae"} className={method === "mae" ? "on" : ""} data-track="identidade-mae" onClick={() => setMethod("mae")}>{t("id.mother")}</button>
        </div>
        {method === "nascimento" ? (
          <DateField label={t("id.birth")} value={birth} onChange={setBirth} invalid={!!error} />
        ) : (
          <div className="field">
            <label htmlFor="mae">{t("id.motherLabel")}</label>
            <MaskedInput id="mae" value={mae} onChange={setMae} mask={nameMask} autoComplete="off" autoCapitalize="words" spellCheck={false} placeholder={t("id.motherPlaceholder")} aria-invalid={!!error} />
            <span className="hint">{t("id.motherHint")}</span>
          </div>
        )}
        <div className="info" role="note"><strong>{t("id.why")}</strong> {t("id.whyText")}</div>
        {error && <p className="err" role="alert">{error}{attemptsLeft !== null && !locked ? ` ${t("id.tries", { n: attemptsLeft })}` : ""}</p>}
        <div className="modal-actions">
          <button type="button" className="ghost" onClick={onClose} data-track="identidade-cancelar">{t("id.cancel")}</button>
          <button type="submit" disabled={busy || locked || !value.trim()} data-track="identidade-confirmar">{busy ? t("id.checking") : t("id.confirm")}</button>
        </div>
      </form>
    </dialog>
  );
}
