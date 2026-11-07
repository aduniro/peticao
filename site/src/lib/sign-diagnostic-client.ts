/** Value-free diagnostics only. No names, e-mails, CPF, identity values or form snapshots. */
let active: string | null = null;
let count = 0;
export function diagnosticTrace(): string | null {
  if (typeof window === "undefined" || typeof navigator === "undefined" || navigator.doNotTrack === "1" || (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl) return null;
  try { if (!active) { active = crypto.randomUUID(); count = 0; } return active; } catch { return null; }
}
export function emitSignDiagnostic(event: string, details: { category?: string; field?: string; outcome?: string } = {}) {
  if (!["started", "field_touched", "browser_invalid", "submit_click", "page_hidden", "page_exit", "client_result"].includes(event)) return;
  const trace = diagnosticTrace(); if (!trace || count++ >= 80) return;
  try {
    const body = JSON.stringify({ trace, event,
      ...(["servidor", "apoiador", "estrangeiro"].includes(details.category ?? "") ? { category: details.category } : {}),
      ...(["name", "email", "cpf", "institution", "role", "campus", "city", "uf", "country", "university", "consent", "regionDeclared", "whatsapp", "whatsappConsent", "identity"].includes(details.field ?? "") ? { field: details.field } : {}),
      ...(["accepted", "rejected", "identity_required", "network_error"].includes(details.outcome ?? "") ? { outcome: details.outcome } : {}) });
    if (typeof navigator.sendBeacon === "function" && navigator.sendBeacon("/api/sign-diagnostic", new Blob([body], { type: "application/json" }))) return;
    void fetch("/api/sign-diagnostic", { method: "POST", credentials: "same-origin", cache: "no-store", keepalive: true, headers: { "content-type": "application/json" }, body }).catch(() => {});
  } catch { /* Diagnostics must never interfere with signing. */ }
}
export function finishSignDiagnostic() { active = null; count = 0; }
