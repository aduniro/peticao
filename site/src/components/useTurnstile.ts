"use client";
import { useCallback, useEffect, useRef } from "react";

declare global { interface Window { turnstile?: { render: (el: HTMLElement, o: Record<string, unknown>) => string; reset: (id?: string) => void } } }

/** Antirrobô Cloudflare Turnstile: desenha o widget em `el` (se houver chave do site) e guarda o token em `token.current`. */
export function useTurnstile(siteKey?: string | null) {
  const token = useRef("");
  const widget = useRef<string | undefined>(undefined);
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!siteKey) return;
    const mount = () => { if (el.current && window.turnstile && !widget.current) widget.current = window.turnstile.render(el.current, { sitekey: siteKey, callback: (t: string) => (token.current = t), "expired-callback": () => (token.current = "") }); };
    if (window.turnstile) mount();
    else { const s = document.createElement("script"); s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"; s.async = true; s.onload = mount; document.head.appendChild(s); }
  }, [siteKey]);
  const reset = useCallback(() => { token.current = ""; if (widget.current) window.turnstile?.reset(widget.current); }, []);
  return { el, token, reset };
}
