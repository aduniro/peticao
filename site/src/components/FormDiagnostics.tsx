"use client";
import { useEffect, useRef, type RefObject } from "react";
import { emitSignDiagnostic } from "@/lib/sign-diagnostic-client";
const fields = new Set(["name", "email", "cpf", "institution", "role", "campus", "city", "uf", "country", "university", "consent", "regionDeclared", "whatsapp", "whatsappConsent"]);
/** Renders no nodes; observes field identifiers/events and never reads field values. */
export default function FormDiagnostics({ formRef, category }: { formRef: RefObject<HTMLFormElement>; category: string }) {
  const touched = useRef(new Set<string>()), started = useRef(false);
  useEffect(() => {
    const form = formRef.current; if (!form) return;
    const mark = (event: string, field?: string) => emitSignDiagnostic(event, { category, ...(field ? { field } : {}) });
    const focus = () => { if (!started.current) { started.current = true; mark("started"); } };
    const input = (event: Event) => {
      focus(); const element = event.target;
      if (!(element instanceof HTMLElement)) return;
      const field = element.getAttribute("name") ?? "";
      if (fields.has(field) && !touched.current.has(field)) { touched.current.add(field); mark("field_touched", field); }
    };
    const invalid = (event: Event) => { const field = (event.target as HTMLElement)?.getAttribute("name") ?? ""; if (fields.has(field)) mark("browser_invalid", field); };
    const submit = () => mark("submit_click");
    const visibility = () => { if (started.current && document.visibilityState === "hidden") mark("page_hidden"); };
    const exit = () => { if (started.current) mark("page_exit"); };
    form.addEventListener("focusin", focus, true); form.addEventListener("input", input, true); form.addEventListener("invalid", invalid, true); form.addEventListener("submit", submit, true);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("pagehide", exit);
    return () => { form.removeEventListener("focusin", focus, true); form.removeEventListener("input", input, true); form.removeEventListener("invalid", invalid, true); form.removeEventListener("submit", submit, true); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("pagehide", exit); };
  }, [formRef, category]);
  return null;
}
