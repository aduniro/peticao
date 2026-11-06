"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages-types";
import { confirmationRecoveryCopy } from "@/content/confirmation-recovery";
import { maskCpf } from "@/lib/cpf-mask";
import MaskedInput, { nameMask } from "./MaskedInput";
import IdentityModal, { type IdentityMethod } from "./IdentityModal";

export default function ConfirmationRecovery({ token, channel, initialName, initialCpf = "", onComplete, onTerminal }: {
  token: string; channel: "email" | "whatsapp"; initialName: string; initialCpf?: string;
  onComplete: (panel: string | null) => void; onTerminal: (result: "invalid" | "expired") => void;
}) {
  const { t, lang } = useI18n();
  const copy = confirmationRecoveryCopy[lang];
  const [name, setName] = useState(initialName), [cpf, setCpf] = useState(initialCpf);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [open, setOpen] = useState(false), [locked, setLocked] = useState(false);
  const [left, setLeft] = useState<number | null>(null);

  async function check(method?: IdentityMethod, value?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(channel === "email" ? "/api/confirmar" : "/api/confirmar/whatsapp", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, recovery: { name, cpf, ...(method ? { identity: { method, value } } : {}) } }),
      });
      const data = await response.json();
      if (data.result === "ok") { setOpen(false); onComplete(data.panel ?? null); return; }
      if (data.result === "invalid" || data.result === "expired") { setOpen(false); onTerminal(data.result); return; }
      if (data.result === "identity_required") { setOpen(true); return; }
      if (data.result === "cpf_mismatch") { setOpen(false); setError(t(data.errors?.cpf === "cpf_invalid" ? "err.cpf_invalid" : "wac.cpfMismatch")); return; }
      if (data.result === "review_required") {
        setOpen(false);
        const code = data.errors?.name ?? data.errors?.cpf ?? "name_cpf_mismatch";
        setError(t(`err.${code}` as MessageKey)); return;
      }
      setLeft(typeof data.attemptsLeft === "number" ? data.attemptsLeft : null);
      setLocked(data.code === "locked" || data.result === "locked");
      const key = `id.err.${data.code ?? "locked"}` as MessageKey;
      setError(t(key) !== key ? t(key) : t("id.err.mismatch"));
    } catch { setError(t("err.generic")); }
    finally { setBusy(false); }
  }

  return <section className="box">
    <h2>{copy.title}</h2>
    {copy.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
    <form className="form" onSubmit={(event) => { event.preventDefault(); void check(); }}>
      <label>{t("f.name")}<MaskedInput value={name} onChange={setName} mask={nameMask} maxLength={120} autoComplete="name" required /></label>
      <label>{t("f.cpf")}<input value={cpf} onChange={(event) => setCpf(maskCpf(event.target.value))} maxLength={14} inputMode="numeric" autoComplete="off" required /></label>
      {error && !open ? <p className="err" role="alert">{error}</p> : null}
      <button className="primary" disabled={busy || locked}>{busy ? t("id.checking") : copy.button}</button>
    </form>
    <IdentityModal open={open} busy={busy} error={error} attemptsLeft={left} locked={locked} onClose={() => setOpen(false)} onConfirm={(method, value) => void check(method, value)} />
  </section>;
}
