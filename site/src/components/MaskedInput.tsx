"use client";
import { forwardRef, useLayoutEffect, useRef, type InputHTMLAttributes } from "react";
import { titleCaseName } from "@/lib/name-case";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> & {
  value: string; onChange: (v: string) => void;
  /** Aplicada a cada tecla (mantém o tamanho do texto, para o cursor não pular) e, com `final`, ao sair do campo. */
  mask: (v: string, final: boolean) => string;
};

/** Campo de texto com máscara de caixa: o valor é transformado enquanto se digita, sem mover o cursor. */
const MaskedInput = forwardRef<HTMLInputElement, Props>(function MaskedInput({ value, onChange, mask, onBlur, ...rest }, fwd) {
  const local = useRef<HTMLInputElement | null>(null);
  const caret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = local.current;
    if (el && caret.current !== null && document.activeElement === el) { try { el.setSelectionRange(caret.current, caret.current); } catch { /* tipo sem seleção */ } }
    caret.current = null;
  });
  return (
    <input {...rest} value={value}
      ref={(el) => { local.current = el; if (typeof fwd === "function") fwd(el); else if (fwd) fwd.current = el; }}
      onChange={(e) => { caret.current = e.target.selectionStart; onChange(mask(e.target.value, false)); }}
      onBlur={(e) => { const f = mask(e.target.value, true); if (f !== value) onChange(f); onBlur?.(e); }} />
  );
});
export default MaskedInput;

/** Máscaras prontas. */
export const nameMask = (v: string, final: boolean) => titleCaseName(v, { final });
export const emailMask = (v: string, final: boolean) => (final ? v.trim() : v.replace(/\s/g, "")).toLowerCase(); // sem Locale (turco: "I" viraria "ı")
