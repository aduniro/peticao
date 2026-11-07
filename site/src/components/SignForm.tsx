"use client";
import { useEffect, useRef, useState } from "react";
import Help from "./Help";
import FormDiagnostics from "./FormDiagnostics";
import HowTo from "./HowTo";
import MaskedInput, { emailMask, nameMask } from "./MaskedInput";
import { isValidCpf, onlyDigits } from "@/lib/cpf";
import PhoneField, { type Fone } from "./PhoneField";
import IdentityModal, { type IdentityMethod } from "./IdentityModal";
import NoticeModal, { Spammy } from "./NoticeModal";
import { SAFE_EMAIL_RE } from "@/lib/email-syntax";
import { suggestEmail } from "@/lib/email-typos";
import { emailSuggestionForCategory } from "@/lib/email-feedback";
import { diagnosticar, type Diagnostico } from "@/lib/email-diagnostico";
import { CountryUniversityFields, IfesCampusFields, UfCityFields, type ServerState } from "./GeoFields";
import { maskCpf } from "@/lib/cpf-mask";
import { formValidationNotice } from "@/lib/form-validation-notice";
import { signRequest } from "@/lib/sign-request";
import { useI18n } from "@/i18n/client";
import { countryName } from "@/i18n";
import type { MessageKey } from "@/i18n/messages-types";

declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void } } }

type Body = Record<string, unknown>;
type Category = "servidor" | "apoiador" | "estrangeiro";
const EMPTY_SERVER: ServerState = { institution: "", ifes: null, role: "", campus: "", campusIbge: null, region: false };

export default function SignForm({ consentBr, consentForeign, turnstileSiteKey, whatsappAtivo = false }: { consentBr: string; consentForeign: string; turnstileSiteKey?: string | null; whatsappAtivo?: boolean }) {
  const { t, lang, country: ipCountry } = useI18n();
  const [category, setCategory] = useState<Category>(ipCountry !== "BR" ? "estrangeiro" : "servidor");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [msg, setMsg] = useState("");
  const [cpf, setCpf] = useState("");
  const [cpfTouched, setCpfTouched] = useState(false);
  const [nameV, setNameV] = useState("");
  const [emailV, setEmailV] = useState("");
  const emailRef = useRef("");
  const formRef = useRef<HTMLFormElement>(null);
  const [notice, setNotice] = useState<null | "sent" | "bad" | "inst" | "field">(null);
  const [fieldNotice, setFieldNotice] = useState<{ title: string; text: string; buttonKey: string } | null>(null);
  const [sentTo, setSentTo] = useState("");
  const [sugg, setSugg] = useState(""); // "Você quis dizer …?" (do navegador ao sair do campo, ou do servidor)
  const [fix, setFix] = useState<Diagnostico | null>(null); // O QUE está errado no e-mail e como digitar (política central: lib/email-diagnostico.ts)
  /** Frase que explica o erro: o que foi digitado, o que deveria estar no lugar e um exemplo de como digitar. */
  const explainFix = (d: Diagnostico | null) => {
    if (!d) return "";
    const key = `ef.${d.problema}${d.correto && (d.problema === "sem_final" || d.problema === "sem_arroba") ? "_c" : ""}` as MessageKey;
    const example = category === "apoiador" ? d.exemplo : emailSuggestionForCategory(category, d.sugestao);
    return `${t(key, { errado: d.errado, correto: d.correto ?? "" })}${example ? ` ${t("ef.exemplo", { exemplo: example })}` : ""}`;
  };
  const emailBad = (v: string) => (v.trim() && !SAFE_EMAIL_RE.test(v.trim()) ? t("f.emailInvalid") : "");
  const [issue, setIssue] = useState<{ code: string; suggest: string } | null>(null); // problema do e-mail (domínio inválido…): campo vermelho até o e-mail validar
  const issueTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const ISSUE = new Set(["email_typo", "email_institutional_invalid", "email_provider_invalid", "server_email_not_institutional", "apoiador_institutional_email"]);
  async function checkRemote(v: string) {
    if (!v || !SAFE_EMAIL_RE.test(v) || (category !== "servidor" && category !== "apoiador")) { setIssue(null); return; }
    try {
      const r = await fetch("/api/email/validar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: v, category }) });
      const j = await r.json();
      if (v !== emailMask(emailRef.current, true)) return; // o usuário já mudou o texto: ignora resposta velha
      setIssue(j.ok ? null : { code: String(j.code), suggest: typeof j.suggest === "string" ? j.suggest : "" });
      setFix((j.ok ? j.soft : j.fix) ?? null);
      if (j.ok) setSugg(j.soft?.sugestao ?? suggestEmail(v) ?? "");
    } catch { /* sem rede: o servidor valida de novo ao enviar */ }
  }
  const emailSuggestion = emailSuggestionForCategory(category, issue?.suggest || sugg || fix?.sugestao, issue?.code);
  const emailFix = fix && (!fix.sugestao || emailSuggestionForCategory(category, fix.sugestao, issue?.code)) ? fix : null;
  const BAD_EMAIL = new Set(["email_not_found", "email_undeliverable", "email_invalid_domain", "email_invalid"]);
  const cpfBad = (cpfTouched || onlyDigits(cpf).length === 11) && !isValidCpf(cpf); // checagem matemática no navegador: CPF inválido nunca chega à CPF Brasil
  const [srv, setSrv] = useState<ServerState>(EMPTY_SERVER);
  const [uf, setUf] = useState(""); const [city, setCity] = useState("");
  const [country, setCountry] = useState(ipCountry !== "BR" ? ipCountry : ""); const [university, setUniversity] = useState("");
  const [detail, setDetail] = useState("");
  const [wa, setWa] = useState<Fone>({ iso: "BR", ddi: "55", numero: "" });
  const [waConsent, setWaConsent] = useState(false);
  const [idOpen, setIdOpen] = useState(false);
  const [idBusy, setIdBusy] = useState(false);
  const [idError, setIdError] = useState("");
  const [idLeft, setIdLeft] = useState<number | null>(null);
  const [idLocked, setIdLocked] = useState(false);
  const pending = useRef<{ body: Body; ticket: string } | null>(null);
  const tsToken = useRef(""); const tsWidget = useRef<string | undefined>(undefined); const tsEl = useRef<HTMLDivElement>(null);
  const foreign = category === "estrangeiro";
  useEffect(() => { window.dispatchEvent(new CustomEvent("peticao:ctx", { detail: { category, country: category === "estrangeiro" ? country : "" } })); }, [category, country]);

  useEffect(() => { if (ipCountry !== "BR" && !country) setCountry(ipCountry); }, [ipCountry]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!turnstileSiteKey) return;
    const mount = () => { if (tsEl.current && window.turnstile && !tsWidget.current) tsWidget.current = window.turnstile.render(tsEl.current, { sitekey: turnstileSiteKey, callback: (t: string) => (tsToken.current = t), "expired-callback": () => (tsToken.current = "") }); };
    if (window.turnstile) mount();
    else { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = mount; document.head.appendChild(s); }
  }, [turnstileSiteKey]);
  const resetTs = () => { tsToken.current = ""; if (tsWidget.current) window.turnstile?.reset(tsWidget.current); };

  /** Código de erro do servidor → texto no idioma da tela (reserva: o próprio texto recebido). */
  const tr = (code: string | undefined, fallback = ""): string => {
    if (!code) return fallback;
    const key = `err.${code}` as MessageKey;
    const base = t(key);
    if (base === key) return fallback || code;
    return code === "university_country_mismatch" ? t(key, { c: detail.split(",").filter(Boolean).map((c) => countryName(c, lang)).join(", ") }) : base;
  };
  const trAll = (e: Record<string, string>) => Object.fromEntries(Object.entries(e).map(([k, v]) => [k, tr(v, v)]));

  function showFieldNotice(fieldErrors: Record<string, string>) {
    const notice = formValidationNotice(fieldErrors, {
      nameMismatch: t("err.name_cpf_mismatch"),
      validationText: (details) => t("field.validationText", { details: details || t("err.generic") }),
    }, (code) => tr(code, code));
    setFieldNotice({ title: t(notice.titleKey as MessageKey), text: notice.text, buttonKey: notice.buttonKey });
    setNotice("field");
  }

  function focusFirstInvalidField() {
    const field = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"]');
    if (!field) return;
    field.scrollIntoView({ behavior: "smooth", block: "center" });
    field.focus();
  }

  function closeFieldNotice() {
    setNotice(null);
    setTimeout(focusFirstInvalidField, 80);
  }

  async function post(body: Body) {
    return signRequest(body);
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const eb = emailBad(emailV);
    if (eb || !emailV.trim()) { const error = eb || t("f.emailInvalid"); setErrors({ email: error }); showFieldNotice({ email: error }); setMsg(""); return; }
    if ((category === "servidor" || category === "apoiador") && !isValidCpf(cpf)) { const error = t("err.cpf_invalid"); setErrors({ cpf: error }); showFieldNotice({ cpf: error }); setMsg(""); return; } // não envia nada: nem ao servidor, nem à CPF Brasil
    setState("sending"); setErrors({}); setMsg("");
    const body: Body = { name: nameMask(nameV, true), email: emailMask(emailV, true), category, consent: f.get("consent") === "on", website: f.get("website"), turnstileToken: tsToken.current, locale: lang };
    if (category === "servidor") Object.assign(body, { cpf, institution: srv.institution, role: srv.role, campus: srv.campus, campusIbge: srv.campusIbge, regionDeclared: srv.region });
    else if (category === "apoiador") Object.assign(body, { cpf, uf, city });
    else Object.assign(body, { country, university });
    if (whatsappAtivo && wa.numero.trim()) Object.assign(body, { whatsapp: { ddi: wa.ddi, numero: wa.numero }, whatsappConsent: waConsent });
    const { status, data } = await post(body);
    if (data.transportError) {
      setState("idle"); resetTs();
      setFieldNotice({ title: t("field.validationTitle"), text: t("contact.err.generic"), buttonKey: "field.correct" });
      setNotice("field");
      return;
    }
    if (data.identityRequired) {
      pending.current = { body, ticket: data.ticket };
      setIdError(""); setIdLeft(null); setIdLocked(false); setState("idle"); setIdOpen(true);
      window.dispatchEvent(new CustomEvent("peticao:event", { detail: { type: "identity_open" } }));
      return;
    }
    resetTs();
    if (data.ok) { setSentTo(emailMask(emailV, true)); setNotice("sent"); return setState("sent"); }
    setState("idle");
    setSugg(typeof data.suggest === "string" && !ISSUE.has(data.errors?.email) ? data.suggest : "");
    setDetail(data.detail ?? "");
    setFix(data.fix ?? null);
    if (data.errors?.email && ISSUE.has(data.errors.email)) { setIssue({ code: data.errors.email, suggest: typeof data.suggest === "string" ? data.suggest : "" }); const { email: _e, ...rest } = data.errors; setErrors(trAll(rest)); }
    else if (data.errors) setErrors(trAll(data.errors));
    if (data.errors) {
      const singleField = Object.keys(data.errors).length === 1;
      if (singleField && BAD_EMAIL.has(data.errors.email)) setNotice("bad");
      else if (singleField && data.errors.email === "apoiador_institutional_email") setNotice("inst");
      else showFieldNotice(data.errors);
    }
    setMsg(data.errors ? "" : tr(data.errorCode, status === 429 ? t("err.rate_limited") : data.error ?? t("err.generic")));
    if (data.errors?.email === "university_country_mismatch") setErrors((x) => ({ ...x, email: t("err.university_country_mismatch", { c: String(data.detail ?? "").split(",").filter(Boolean).map((c: string) => countryName(c, lang)).join(", ") }) }));
  }

  async function onIdentity(method: IdentityMethod, value: string) {
    if (!pending.current) return;
    setIdBusy(true); setIdError("");
    const { status, data } = await post({ ...pending.current.body, ticket: pending.current.ticket, identity: { method, value } });
    setIdBusy(false);
    if (data.transportError) { setIdError(t("contact.err.generic")); return; }
    if (data.ok) { setIdOpen(false); resetTs(); setSentTo(emailMask(emailV, true)); setNotice("sent"); return setState("sent"); }
    if (data.restart) { setIdOpen(false); setMsg(tr(data.errorCode, data.error)); return; }
    if (status === 503 || data.error) { setIdError(tr(data.errorCode, data.error ?? t("err.identity_unavailable"))); return; }
    if (data.errors) {
      setIdOpen(false); setErrors(trAll(data.errors)); setSugg(typeof data.suggest === "string" ? data.suggest : ""); setFix(data.fix ?? null);
      const singleField = Object.keys(data.errors).length === 1;
      if (singleField && BAD_EMAIL.has(data.errors.email)) setNotice("bad");
      else if (singleField && data.errors.email === "apoiador_institutional_email") setNotice("inst");
      else showFieldNotice(data.errors);
      return;
    }
    setIdLocked(!!data.locked);
    setIdLeft(typeof data.attemptsLeft === "number" ? data.attemptsLeft : null);
    const k = `id.err.${data.identityCode}` as MessageKey;
    setIdError(t(k) !== k ? t(k) : data.identityError ?? t("id.err.mismatch"));
  }

  const modals = (
    <>
      <NoticeModal open={notice === "sent"} title={t("sent.title")} text={t("sent.text", { email: sentTo })} ok={t("sent.ok")} onClose={() => setNotice(null)} />
      <NoticeModal open={notice === "inst"} tone="error" title={t("inst.title")} text={t("inst.text")} ok={t("inst.ok")} onClose={() => { setNotice(null); setCategory("servidor"); setErrors({}); setIssue(null); setFix(null); setSugg(""); setMsg(""); setTimeout(() => document.getElementById("assinar")?.scrollIntoView({ behavior: "smooth" }), 80); }} />
      <NoticeModal open={notice === "bad"} tone="error" title={t("bad.title")} text={t("bad.text", { email: emailMask(emailV, true) }) + (emailFix ? " " + explainFix(emailFix) : "")} ok={t("bad.ok")} onClose={() => { setNotice(null); setTimeout(() => document.querySelector<HTMLInputElement>('input[name="email"]')?.focus(), 60); }} />
      <NoticeModal open={notice === "field"} tone="error" title={fieldNotice?.title ?? t("field.validationTitle")} text={fieldNotice?.text ?? t("err.generic")} ok={t((fieldNotice?.buttonKey ?? "field.correct") as MessageKey)} onClose={closeFieldNotice} />
    </>
  );
  if (state === "sent")
    return (
      <>
        <div className="box ok" role="status">
          <h3>{t("ok.title")}</h3>
          <p><Spammy text={t("ok.text")} /></p>
        </div>
        {modals}
      </>
    );

  const err = (k: string) => (errors[k] ? <span id={`error-${k}`} className="err" role="alert">{errors[k]}</span> : null);
  const startTour = (c: Category, force = false) => window.dispatchEvent(new CustomEvent("peticao:tour", { detail: { category: c, force } }));
  const cat = (c: Category, label: string) => (
    <span className="seg-cell">
      <button type="button" role="radio" aria-checked={category === c} className={category === c ? "on" : ""} data-track={`categoria-${c}`}
        onClick={() => { setCategory(c); setErrors({}); setIssue(null); setSugg(""); setMsg(""); setTimeout(() => startTour(c), 300); }}>{label}</button>
      <Help text={t(`help.cat.${c}` as MessageKey)} label={`${t("help.label")}: ${label}`} />
    </span>
  );
  return (
    <>
      <form ref={formRef} onSubmit={onSubmit} className="form" noValidate>
        <FormDiagnostics formRef={formRef} category={category} />
        <div className="form-head"><h2 className="form-title">{t("form.title")}</h2><HowTo onYes={() => startTour(category, true)} /></div>
        <div className="segmented three" data-tour="tabs" role="radiogroup" aria-label={t("cat.label")}>
          {cat("servidor", t("cat.servidor"))}{cat("apoiador", t("cat.apoiador"))}{cat("estrangeiro", t("cat.estrangeiro"))}
        </div>
        {err("category")}
        <label>{t("f.name")}<MaskedInput name="name" autoComplete="name" autoCapitalize="words" spellCheck={false} required aria-invalid={!!errors.name} aria-describedby={errors.name ? "error-name" : undefined} value={nameV} onChange={setNameV} mask={nameMask} />{err("name")}</label>
        <label data-tour="email">{t("f.email")}{category === "servidor" && <Help text={t("help.email.servidor")} />}<MaskedInput name="email" type="email" inputMode="email" autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} required aria-invalid={!!errors.email || !!issue} aria-describedby={errors.email ? "error-email" : issue ? "error-email-issue" : undefined} value={emailV} onChange={(v) => { setEmailV(v); emailRef.current = v; setSugg(""); setFix(null); if (errors.email) setErrors((x) => ({ ...x, email: "" })); if (issue) { clearTimeout(issueTimer.current); issueTimer.current = setTimeout(() => checkRemote(emailMask(v, true)), 700); } }} onBlur={() => { const v = emailMask(emailV, true); const m = emailBad(v); if (m) { setErrors((x) => ({ ...x, email: m })); setIssue(null); const dg = diagnosticar(v); setFix(dg); setSugg(dg?.sugestao ?? ""); } else { const dg = diagnosticar(v); setFix(dg); setSugg(dg?.sugestao ?? suggestEmail(v) ?? ""); checkRemote(v); } }} mask={emailMask} />{err("email")}{issue && <span id="error-email-issue" className="err" role="alert">{t(`err.${issue.code}` as MessageKey)}{issue.code === "email_provider_invalid" && <><br /><span style={{ fontWeight: 400 }}>{t("f.emailProviders")}</span></>}</span>}{emailFix && <span className={issue || emailFix.bloqueia ? "err" : "hint"} role={issue || emailFix.bloqueia ? "alert" : "status"} style={{ fontWeight: 400 }}>{explainFix(emailFix)}</span>}{emailSuggestion && ( <span className="err" role="status" style={{ color: "inherit" }}>{t("f.emailSuggest", { email: emailSuggestion })} <button type="button" className="linklike" onClick={() => { const e = emailSuggestion; setEmailV(e); emailRef.current = e; setSugg(""); setFix(null); setIssue(null); setErrors((x) => ({ ...x, email: "" })); checkRemote(e); }}>{t("f.emailUse")}</button></span>)}
          <span className="hint">{foreign ? t("f.emailHintForeign") : category === "servidor" ? t("f.emailHintServer") : t("f.emailHint")}</span></label>
        {whatsappAtivo && (
          <div className="wa-field" data-tour="whatsapp">
            <div className="wa-box"><span className="wa-label" id="wa-label">{t("f.whatsapp")}</span><PhoneField value={wa} onChange={setWa} error={errors.whatsapp} /></div>
            <span className="hint">{t("f.whatsappHint")}</span>
            {wa.numero.trim() ? <label className="consent"><input type="checkbox" checked={waConsent} onChange={(e) => setWaConsent(e.target.checked)} /> <span>{t("f.whatsappConsent")}</span></label> : null}
            {err("whatsappConsent")}
          </div>
        )}
        {!foreign && (
          <label data-tour="cpf">{t("f.cpf")}<Help text={t("help.cpf")} /><input name="cpf" inputMode="numeric" autoComplete="off" placeholder="999.999.999-99" maxLength={14} value={cpf} onBlur={() => setCpfTouched(true)} onChange={(e) => { setCpf(maskCpf(e.target.value)); if (errors.cpf) setErrors((x) => ({ ...x, cpf: "" })); }} aria-invalid={!!errors.cpf || cpfBad} aria-describedby={cpfBad ? "cpf-erro" : undefined} required />{cpfBad ? <span id="cpf-erro" className="err" role="alert">{t("err.cpf_invalid")}</span> : err("cpf")}</label>
        )}
        {category === "servidor" && <IfesCampusFields s={srv} set={(p) => setSrv((x) => ({ ...x, ...p }))} errors={errors} />}
        {category === "apoiador" && <UfCityFields uf={uf} city={city} setUf={setUf} setCity={setCity} errors={errors} />}
        {foreign && <CountryUniversityFields country={country} setCountry={setCountry} university={university} setUniversity={setUniversity} errors={errors} />}
        <input name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" className="hp" />
        {turnstileSiteKey && <div ref={tsEl} className="turnstile" />}
        <label className="consent" data-tour="consent"><input type="checkbox" name="consent" aria-invalid={!!errors.consent} /> <span>{foreign ? consentForeign : consentBr}</span></label>
        {err("consent")}
        {msg && <p className="err" role="alert">{msg}</p>}
        <button className="primary" disabled={state === "sending"} data-tour="submit" data-track="assinar">{state === "sending" ? t("f.sending") : t("f.submit")}</button>
        <p className="small">{foreign ? t("f.privacyForeign") : t("f.privacy")} <a href="/privacidade">{t("f.privacyLink")}</a>.</p>
      </form>
      {modals}
      <IdentityModal open={idOpen} busy={idBusy} error={idError} attemptsLeft={idLeft} locked={idLocked} onClose={() => setIdOpen(false)} onConfirm={onIdentity} />
    </>
  );
}
