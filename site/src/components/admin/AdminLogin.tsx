"use client";
import { useState } from "react";
import { useTurnstile } from "@/components/useTurnstile";
import CampoSenha from "./CampoSenha";

const ERRO: Record<string, string> = {
  local: "O painel só abre para IPs de Rondônia. Se você está em Rondônia e usa VPN, desligue-a e tente de novo.",
  robo: "A verificação de segurança falhou. Recarregue a página e tente de novo.",
  limite: "Muitas tentativas. Aguarde alguns minutos e tente de novo.",
  bloqueado: "Conta bloqueada por 15 minutos depois de muitas tentativas erradas. Tente de novo mais tarde ou use \"Esqueci minha senha\".",
  nivel: "O seu nível de acesso não permite abrir aquela página.",
  "1": "Senha incorreta.",
  "2": "E-mail ou senha incorretos.",
};
const MSG: Record<string, string> = {
  "reset-enviado": "Se o e-mail estiver cadastrado, enviamos um link para redefinir a senha (vale 30 minutos).",
  "senha-redefinida": "Senha redefinida. Entre com a nova senha.",
  "senha-alterada": "Senha alterada. Entre novamente com a nova senha.",
  saiu: "Você saiu do painel.",
};

/** Login do painel: e-mail e senha (quando já existem usuários) ou só a senha única antiga (transição), mais a verificação antirrobô (Turnstile). */
export default function AdminLogin({ siteKey, erro, msg, porUsuario }: { siteKey: string | null; erro?: string; msg?: string; porUsuario: boolean }) {
  const { el, token } = useTurnstile(siteKey);
  const [busy, setBusy] = useState(false);
  const textoErro = erro ? (erro === "1" && porUsuario ? ERRO["2"] : ERRO[erro] ?? ERRO[porUsuario ? "2" : "1"]) : null;
  return (
    <form method="post" action="/api/admin/login" onSubmit={(e) => {
      if (siteKey && !token.current) { e.preventDefault(); alert("Aguarde a verificação de segurança terminar."); return; }
      const f = e.currentTarget; let h = f.querySelector<HTMLInputElement>("input[name=turnstile]");
      if (!h) { h = document.createElement("input"); h.type = "hidden"; h.name = "turnstile"; f.appendChild(h); }
      h.value = token.current; setBusy(true);
    }}>
      {msg && MSG[msg] ? <p className="box ok" role="status">{MSG[msg]}</p> : null}
      {porUsuario ? <label>E-mail<input type="email" name="email" required autoComplete="username" autoCapitalize="none" spellCheck={false} /></label> : null}
      <label>Senha<CampoSenha name="password" required autoComplete="current-password" /></label>
      {siteKey ? <div ref={el} style={{ minHeight: 65 }} /> : null}
      {textoErro ? <p className="err" role="alert">{textoErro}</p> : null}
      <button className="v2-login-btn" disabled={busy}>{busy ? "Entrando…" : "Entrar"}</button>
      {porUsuario ? <p className="v2-login-pe"><a href="/admin/esqueci">Esqueci minha senha</a></p> : null}
    </form>
  );
}
