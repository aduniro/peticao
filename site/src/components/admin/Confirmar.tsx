"use client";
import { useState } from "react";

const MSG: Record<string, string> = { senha: "A senha não confere.", codigo: "Código errado ou vencido. Peça outro.", muitos_pedidos: "Muitos códigos pedidos. Aguarde até uma hora.", muitas_tentativas: "Muitas tentativas. Aguarde alguns minutos.", sem_conta: "Este acesso não tem conta de usuário." };

/** Confirmação extra: pede o código por e-mail e confere senha + código. */
export default function Confirmar({ email, volta }: { email: string; volta: string }) {
  const [enviado, setEnviado] = useState(false), [erro, setErro] = useState<string | null>(null), [ocupado, setOcupado] = useState(false);
  const chamar = async (corpo: object) => {
    setOcupado(true); setErro(null);
    try { const r = await fetch("/api/admin/stepup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo), credentials: "same-origin" }); return { ok: r.ok, j: await r.json().catch(() => ({})) }; }
    finally { setOcupado(false); }
  };
  const pedir = async () => { const r = await chamar({ passo: "pedir" }); if (r.ok) setEnviado(true); else setErro(MSG[r.j.erro] ?? "Não foi possível enviar o código."); };
  const confirmar = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const r = await chamar({ passo: "confirmar", senha: f.get("senha"), codigo: f.get("codigo") });
    if (r.ok) window.location.assign(volta); else setErro(MSG[r.j.erro] ?? "Não foi possível confirmar.");
  };
  return (
    <div className="form" style={{ maxWidth: 420 }}>
      <p>Para liberar as ações do painel, confirme que é você: o sistema manda um código de 6 dígitos para <strong>{email}</strong> e pede a senha de novo. A liberação vale por 15 minutos.</p>
      {!enviado ? <button type="button" onClick={pedir} disabled={ocupado}>Enviar o código por e-mail</button> : (
        <form onSubmit={confirmar} className="form">
          <p className="box ok" role="status">Código enviado. Vale 10 minutos.</p>
          <label>Código de 6 dígitos<input name="codigo" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} required autoComplete="one-time-code" /></label>
          <label>Sua senha<input type="password" name="senha" required autoComplete="current-password" /></label>
          <button disabled={ocupado}>Confirmar</button>
          <button type="button" className="link" onClick={pedir} disabled={ocupado}>Enviar outro código</button>
        </form>
      )}
      {erro ? <p className="err" role="alert">{erro}</p> : null}
    </div>
  );
}
