"use client";
import { useState } from "react";
import { useTurnstile } from "@/components/useTurnstile";

const MSG: Record<string, string> = {
  local: "O painel só abre para IPs de Rondônia. Se você está em Rondônia e usa VPN, desligue-a e tente de novo.",
  robo: "A verificação de segurança falhou. Recarregue a página e tente de novo.",
  limite: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  "1": "Senha incorreta.",
};

/** Login do painel: senha + verificação antirrobô (Turnstile). O token do Turnstile segue num campo oculto. */
export default function AdminLogin({ siteKey, erro }: { siteKey: string | null; erro?: string }) {
  const { el, token } = useTurnstile(siteKey);
  const [busy, setBusy] = useState(false);
  return (
    <form method="post" action="/api/admin/login" className="form" onSubmit={(e) => {
      if (siteKey && !token.current) { e.preventDefault(); alert("Aguarde a verificação de segurança terminar."); return; }
      const f = e.currentTarget; let h = f.querySelector<HTMLInputElement>("input[name=turnstile]");
      if (!h) { h = document.createElement("input"); h.type = "hidden"; h.name = "turnstile"; f.appendChild(h); }
      h.value = token.current; setBusy(true);
    }}>
      <label>Senha<input type="password" name="password" required autoComplete="current-password" /></label>
      {siteKey ? <div ref={el} style={{ minHeight: 65 }} /> : null}
      {erro ? <p className="err" role="alert">{MSG[erro] ?? MSG["1"]}</p> : null}
      <button disabled={busy}>Entrar</button>
    </form>
  );
}
