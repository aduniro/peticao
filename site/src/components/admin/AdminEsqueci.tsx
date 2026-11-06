"use client";
import { useState } from "react";
import { useTurnstile } from "@/components/useTurnstile";

/** Pedido de redefinição de senha: e-mail + verificação antirrobô (Turnstile). */
export default function AdminEsqueci({ siteKey }: { siteKey: string | null }) {
  const { el, token } = useTurnstile(siteKey);
  const [busy, setBusy] = useState(false);
  return (
    <form method="post" action="/api/admin/esqueci" onSubmit={(e) => {
      if (siteKey && !token.current) { e.preventDefault(); alert("Aguarde a verificação de segurança terminar."); return; }
      const f = e.currentTarget; let h = f.querySelector<HTMLInputElement>("input[name=turnstile]");
      if (!h) { h = document.createElement("input"); h.type = "hidden"; h.name = "turnstile"; f.appendChild(h); }
      h.value = token.current; setBusy(true);
    }}>
      <label>E-mail<input type="email" name="email" required autoComplete="username" autoCapitalize="none" spellCheck={false} /></label>
      {siteKey ? <div ref={el} style={{ minHeight: 65 }} /> : null}
      <button className="v2-login-btn" disabled={busy}>{busy ? "Enviando…" : "Enviar o link"}</button>
    </form>
  );
}
