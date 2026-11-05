"use client";
import { useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages-types";
import { isValidCpf, onlyDigits } from "@/lib/cpf";
import { maskCpf } from "@/lib/cpf-mask";

/** Confirmação pelo link do WhatsApp: CPF + data de nascimento OU nome da mãe (nada é gravado) e opção de usar o link do e-mail. */
export default function WhatsappConfirm({ token, foreign }: { token: string; foreign: boolean }) {
  const { t } = useI18n();
  const [cpf, setCpf] = useState("");
  const [method, setMethod] = useState<"nascimento" | "mae">("nascimento");
  const [value, setValue] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "ok">("idle");
  const [err, setErr] = useState("");
  const [panel, setPanel] = useState<string | null>(null);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (!foreign && !isValidCpf(cpf)) { setErr(t("err.cpf_invalid")); return; }
    setState("busy"); setErr("");
    const r = await fetch("/api/confirmar/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, cpf: onlyDigits(cpf), method, value }) });
    const j = await r.json().catch(() => ({}));
    if (j.result === "ok") { setPanel(j.panel ?? null); setState("ok"); return; }
    setState("idle");
    if (j.result === "cpf_mismatch") setErr(t("wac.cpfMismatch"));
    else if (j.result === "identity") { const k = `id.err.${j.code}` as MessageKey; setErr(t(k) !== k ? t(k) : t("id.err.mismatch")); }
    else if (j.result === "locked") setErr(t("err.rate_limited"));
    else setErr(t("wac.invalid"));
  }

  if (state === "ok") return <div className="box ok" role="status"><h3>{t("wac.done")}</h3><p>{t("confirm.okText")}</p>{panel ? <p><a className="primary" href={panel}>{t("confirm.openNow")}</a></p> : null}</div>;
  return (
    <form onSubmit={enviar} className="form" noValidate>
      {foreign ? <p>{t("wac.foreignText")}</p> : (
        <>
          <p>{t("wac.text")}</p>
          <label>{t("f.cpf")}<input name="cpf" inputMode="numeric" autoComplete="off" placeholder="999.999.999-99" maxLength={14} value={cpf} onChange={(e) => setCpf(maskCpf(e.target.value))} /></label>
          <div className="segmented" role="radiogroup" aria-label={t("id.method")}>
            <button type="button" role="radio" aria-checked={method === "nascimento"} className={method === "nascimento" ? "on" : ""} onClick={() => { setMethod("nascimento"); setValue(""); }}>{t("id.birth")}</button>
            <button type="button" role="radio" aria-checked={method === "mae"} className={method === "mae" ? "on" : ""} onClick={() => { setMethod("mae"); setValue(""); }}>{t("id.mother")}</button>
          </div>
          <label>{method === "nascimento" ? t("wac.birthLabel") : t("id.motherLabel")}
            <input name="valor" autoComplete="off" inputMode={method === "nascimento" ? "numeric" : "text"} placeholder={method === "nascimento" ? "dd/mm/aaaa" : t("id.motherPlaceholder")} value={value} onChange={(e) => setValue(e.target.value)} /></label>
          <p className="small">{t("wac.privacy")}</p>
        </>
      )}
      {err ? <p className="err" role="alert">{err}</p> : null}
      <button className="primary" disabled={state === "busy"}>{state === "busy" ? t("confirm.loading") : t("wac.button")}</button>
      <p className="small">{t("wac.emailAlt")}</p>
    </form>
  );
}
