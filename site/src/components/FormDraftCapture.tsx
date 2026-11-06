"use client";
import { useEffect, useRef, useState, type RefObject } from "react";
import { useI18n } from "@/i18n/client";
import { DRAFT_CAPABILITY_DAYS, DRAFT_CAPABILITY_STORAGE_KEY, loadDraftCapability, persistDraftCapability, removeDraftCapability, type DraftCapability, type DraftCapabilityStorage } from "@/lib/form-draft-capability";

type Snapshot = Record<string, string | boolean | null | undefined>;
type DraftEvent = { stage: string; invalidFields?: string[]; outcome?: string };
const MAX_BYTES = 12_000;
const copy = {
  pt: { label: "Opcional: autorizo guardar os dados que preencher neste formulário e as etapas da tentativa por até 30 dias, para ajudar a organização a identificar problemas. O CPF será guardado somente em hash. Esta opção não registra a data de nascimento nem o nome da mãe digitados na confirmação. Posso desmarcar para apagar este rascunho. A assinatura funciona sem esta autorização.", active: "Registro opcional de rascunho ativado.", error: "Não foi possível registrar o rascunho; você pode continuar assinando normalmente.", removing: "Apagando o rascunho…", removed: "Rascunho apagado e registro desativado.", removeError: "Não foi possível confirmar a exclusão do rascunho. Tente novamente.", retry: "Tentar apagar novamente", previous: "Apagar rascunho anterior", stopped: "Registro de rascunho desativado nesta aba.", memoryWarning: "O armazenamento deste navegador está bloqueado. Você pode apagar o rascunho nesta aba, mas o controle será perdido ao fechá-la; o conteúdo restante expira em até 30 dias." },
  en: { label: "Optional: I allow the information entered in this form and the attempt stages to be stored for up to 30 days to help the organizers identify problems. CPF is stored only as a hash. This option does not record the birth date or mother's name entered during confirmation. Uncheck to delete this draft. Signing does not require this permission.", active: "Optional draft recording enabled.", error: "The draft could not be recorded. You can still sign normally.", removing: "Deleting the draft…", removed: "Draft deleted and recording disabled.", removeError: "Draft deletion could not be confirmed. Please try again.", retry: "Retry deletion", previous: "Delete previous draft", stopped: "Draft recording disabled in this tab.", memoryWarning: "Browser storage is blocked. You can delete the draft in this tab, but this control will be lost when it closes; remaining contents expire within 30 days." },
};

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...Array.from(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Explicit opt-in only. This component never receives identity challenge values. */
export default function FormDraftCapture({ snapshot, formRef, completed = false }: { snapshot: Snapshot; formRef: RefObject<HTMLFormElement>; completed?: boolean }) {
  const { lang } = useI18n();
  const text = lang === "pt" ? copy.pt : copy.en;
  const [checked, setChecked] = useState(false);
  const [status, setStatus] = useState<"" | "active" | "error" | "removing" | "removed" | "removeError" | "stopped">("");
  const current = useRef(snapshot); current.current = snapshot;
  const capability = useRef<DraftCapability | null>(null);
  const storage = useRef<DraftCapabilityStorage | null>(null);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [persistentStorage, setPersistentStorage] = useState(true);
  const active = useRef(false), token = useRef(""), sequence = useRef(0), lastSent = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();
  const queue = useRef(Promise.resolve());
  const withdrawing = useRef("");
  const flush = useRef<(event: DraftEvent, beacon?: boolean) => void>(() => {});
  const available = process.env.NEXT_PUBLIC_FORM_DRAFTS === "1";

  flush.current = (event, beacon = false) => {
    if (!available || completed || !active.current || !token.current) return;
    if (capability.current && capability.current.expiresAt <= Date.now()) {
      removeDraftCapability(storage.current, capability.current.token);
      capability.current = null; active.current = false; token.current = ""; setChecked(false); setHasPrevious(false); setStatus("stopped");
      return;
    }
    clearTimeout(timer.current);
    const previous = loadDraftCapability(storage.current).capability;
    if (previous?.token === token.current) sequence.current = Math.max(sequence.current, previous.sequence);
    sequence.current++;
    if (capability.current) {
      capability.current = { ...capability.current, sequence: sequence.current };
      if (!persistDraftCapability(storage.current, capability.current)) setPersistentStorage(false);
    }
    const consent = formRef.current?.querySelector<HTMLInputElement>('input[name="consent"]')?.checked === true;
    const body = JSON.stringify({ token: token.current, sequence: sequence.current, optIn: true, ...event, snapshot: { ...current.current, consent } });
    if (new TextEncoder().encode(body).byteLength > MAX_BYTES) return;
    lastSent.current = Date.now();
    if (beacon && navigator.sendBeacon?.("/api/form-draft", new Blob([body], { type: "text/plain" }))) return;
    const owner = token.current;
    queue.current = queue.current.then(async () => {
      if (!active.current || token.current !== owner) return;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch("/api/form-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, signal: controller.signal });
        const result = await response.json();
        if (active.current && token.current === owner) setStatus(response.ok && result.saved ? "active" : "error");
      } catch { if (active.current && token.current === owner) setStatus("error"); }
      finally { clearTimeout(timeout); }
    });
  };

  useEffect(() => {
    if (!available) return;
    try { storage.current = window.localStorage; } catch { storage.current = null; }
    const remembered = loadDraftCapability(storage.current);
    setPersistentStorage(remembered.available);
    capability.current = remembered.capability;
    setHasPrevious(!!remembered.capability);
    // Reload never re-enables collection: every tab starts unchecked.
    const changed = (event: StorageEvent) => {
      if (event.key !== DRAFT_CAPABILITY_STORAGE_KEY && event.key !== null) return;
      const next = loadDraftCapability(storage.current).capability;
      if (active.current && (!next || next.token !== token.current)) {
        active.current = false; token.current = ""; setChecked(false); clearTimeout(timer.current); setStatus("stopped");
      }
      capability.current = next; setHasPrevious(!!next);
      if (next) sequence.current = Math.max(sequence.current, next.sequence);
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [available]);

  useEffect(() => {
    if (!available || completed) return;
    const form = formRef.current;
    if (!form) return;
    const editing = () => {
      if (!active.current) return;
      clearTimeout(timer.current);
      timer.current = setTimeout(() => flush.current({ stage: "editing" }), Math.max(1500, 2500 - (Date.now() - lastSent.current)));
    };
    const blur = () => { if (active.current) { clearTimeout(timer.current); timer.current = setTimeout(() => flush.current({ stage: "blur" }), 200); } };
    const click = (e: Event) => { if ((e.target as Element)?.closest('button[data-track="assinar"]')) flush.current({ stage: "submit_click" }); };
    const submit = () => flush.current({ stage: "submit" });
    const invalid = (e: Event) => flush.current({ stage: "browser_invalid", invalidFields: [(e.target as HTMLInputElement).name] });
    const result = (e: Event) => { const detail = (e as CustomEvent<{ outcome: string; invalidFields?: string[] }>).detail; flush.current({ stage: "server_result", outcome: detail.outcome, invalidFields: detail.invalidFields }); };
    const invalidForm = (e: Event) => flush.current({ stage: "browser_invalid", invalidFields: (e as CustomEvent<{ fields: string[] }>).detail.fields });
    const hidden = () => { if (document.visibilityState === "hidden") flush.current({ stage: "hidden" }, true); };
    form.addEventListener("input", editing); form.addEventListener("change", editing);
    form.addEventListener("focusout", blur); form.addEventListener("click", click, true);
    form.addEventListener("submit", submit, true); form.addEventListener("invalid", invalid, true);
    form.addEventListener("form-draft-result", result); form.addEventListener("form-draft-invalid", invalidForm);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      clearTimeout(timer.current);
      form.removeEventListener("input", editing); form.removeEventListener("change", editing);
      form.removeEventListener("focusout", blur); form.removeEventListener("click", click, true);
      form.removeEventListener("submit", submit, true); form.removeEventListener("invalid", invalid, true);
      form.removeEventListener("form-draft-result", result); form.removeEventListener("form-draft-invalid", invalidForm);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [available, formRef, completed]);

  async function withdraw() {
    active.current = false; setChecked(false); clearTimeout(timer.current);
    const previous = withdrawing.current || token.current || capability.current?.token || "";
    withdrawing.current = previous; token.current = "";
    if (!previous) { setStatus("removed"); return; }
    setStatus("removing");
    await queue.current;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetch("/api/form-draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "withdraw", token: previous }), keepalive: true, signal: controller.signal });
      if (!response.ok) throw new Error("withdraw_failed");
      if (!removeDraftCapability(storage.current, previous)) { storage.current = null; setPersistentStorage(false); }
      capability.current = null; setHasPrevious(false);
      withdrawing.current = ""; setStatus("removed");
    } catch { setStatus("removeError"); }
    finally { clearTimeout(timeout); }
  }

  if (!available || (completed && !checked && !hasPrevious && !withdrawing.current)) return null;
  return <div className="draft-opt-in">
    <label className="consent"><input type="checkbox" checked={checked} disabled={(completed && !checked) || status === "removing" || !!withdrawing.current} onChange={(event) => {
      if (!event.target.checked) { void withdraw(); return; }
      const remembered = loadDraftCapability(storage.current).capability || capability.current;
      capability.current = remembered && remembered.expiresAt > Date.now() ? remembered : { token: randomToken(), sequence: 0, expiresAt: Date.now() + DRAFT_CAPABILITY_DAYS * 86400_000 };
      token.current = capability.current.token; sequence.current = capability.current.sequence; active.current = true; setChecked(true); setHasPrevious(true);
      if (!persistDraftCapability(storage.current, capability.current)) setPersistentStorage(false);
      flush.current({ stage: "opt_in" });
    }} /><span>{text.label}</span></label>
    {!checked && hasPrevious && status !== "removing" && status !== "removeError" && <button type="button" className="linklike" onClick={() => void withdraw()}>{text.previous}</button>}
    {!persistentStorage && (checked || hasPrevious) && <p className="small" role="status">{text.memoryWarning}</p>}
    {status && <p className="small" role="status">{text[status]}</p>}
    {status === "removeError" && <button type="button" className="linklike" onClick={() => void withdraw()}>{text.retry}</button>}
  </div>;
}
