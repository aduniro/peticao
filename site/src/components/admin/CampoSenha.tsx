"use client";
import { useState } from "react";

const OLHO = "M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12zm10 3.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4z";
const OLHO_CORTADO = "M3 3l18 18M10.6 5.1A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.7 6.7A16.6 16.6 0 0 0 2 12s3.6 7 10 7a10 10 0 0 0 4.2-.9M9.9 9.9a3.2 3.2 0 0 0 4.2 4.2";

/** Campo de senha com o botão padrão de olho (mostrar/ocultar). Os atributos do input vêm de fora (name, autoComplete, minLength...). */
export default function CampoSenha(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [ver, setVer] = useState(false);
  return (
    <span className="v2-senha">
      <input {...props} type={ver ? "text" : "password"} />
      <button type="button" className="v2-olho" aria-label={ver ? "Ocultar a senha" : "Mostrar a senha"} aria-pressed={ver} onClick={() => setVer((v) => !v)}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={ver ? OLHO_CORTADO : OLHO} /></svg>
      </button>
    </span>
  );
}
