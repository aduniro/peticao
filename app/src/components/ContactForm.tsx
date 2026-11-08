"use client";
import { useState } from "react";
import MaskedInput, { emailMask, nameMask } from "./MaskedInput";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages-types";
import { useTurnstile } from "./useTurnstile";

const KINDS = ["duvida", "bug", "outro"] as const;

export default function ContactForm({ turnstileSiteKey }: { turnstileSiteKey?: string | null }) {
  const { t, lang } = useI18n();
  const ts = useTurnstile(turnstileSiteKey);
  const [name, setName] = useState(""); const [email, setEmail] = useState("");
  const [kind, setKind] = useState<string>(""); const [message, setMessage] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState(""); const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const tr = (code: string, scope = "err") => { const k = `${scope}.${code}` as MessageKey; const v = t(k); return v === k ? code : v; };

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setState("sending"); setErrors({}); setMsg("");
    const res = await fetch("/api/contato", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: nameMask(name, true), email: emailMask(email, true), kind, message, locale: lang, website: f.get("website"), turnstileToken: ts.token.current }) });
    const d = await res.json().catch(() => ({}));
    ts.reset();
    if (d.ok) return setState("sent");
    setState("idle");
    if (d.errors) { setErrors(Object.fromEntries(Object.entries(d.errors as Record<string, string>).map(([k, v]) => [k, k === "message" || k === "kind" ? tr(v, "contact.err") : tr(v)]))); setMsg(t("err.generic")); }
    else setMsg(tr(d.errorCode ?? "generic", "contact.err"));
  }

  if (state === "sent") return <div className="box ok" role="status"><h2>{t("contact.ok.title")}</h2><p>{t("contact.ok.text")}</p><p><a href="/">{t("contact.back")}</a></p></div>;
  const err = (k: string) => (errors[k] ? <span className="err">{errors[k]}</span> : null);
  return (
    <form onSubmit={onSubmit} className="form" noValidate>
      <label>{t("f.name")}<MaskedInput name="name" autoComplete="name" autoCapitalize="words" spellCheck={false} required value={name} onChange={setName} mask={nameMask} aria-invalid={!!errors.name} />{err("name")}</label>
      <label>{t("f.email")}<MaskedInput name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required value={email} onChange={setEmail} mask={emailMask} aria-invalid={!!errors.email} />{err("email")}</label>
      <label>{t("contact.kind")}
        <select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} aria-invalid={!!errors.kind}>
          <option value="" disabled>{t("f.roleSelect")}</option>
          {KINDS.map((k) => <option key={k} value={k}>{t(`contact.kind.${k}` as MessageKey)}</option>)}
        </select>{err("kind")}</label>
      <label>{t("contact.message")}
        <textarea name="message" rows={7} maxLength={4000} value={message} onChange={(e) => setMessage(e.target.value)} aria-invalid={!!errors.message} required />
        <span className="hint">{t("contact.messageHint")}</span>{err("message")}</label>
      <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
      {turnstileSiteKey && <div ref={ts.el} className="turnstile" />}
      {msg && <p className="err" role="alert">{msg}</p>}
      <button className="primary" disabled={state === "sending"} data-track="contato-enviar">{state === "sending" ? t("contact.sending") : t("contact.send")}</button>
      <p className="small"><a href="/privacidade">{t("f.privacyLink")}</a></p>
    </form>
  );
}
