"use client";
import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";
import type { MessageKey } from "@/i18n/messages-types";

type Cat = "servidor" | "apoiador" | "estrangeiro";
/** Passos de cada tour: [alvo (data-tour), texto]. Cada dica fica ~5 s (padrão de apps) e some sozinha; nada trava a tela. */
const STEPS: Record<Cat, [string, MessageKey][]> = {
  servidor: [["email", "tour.servidor.email"], ["ifes", "tour.servidor.ifes"], ["campus", "tour.servidor.campus"], ["region", "tour.servidor.region"], ["submit", "tour.servidor.submit"]],
  apoiador: [["email", "tour.apoiador.email"], ["cpf", "tour.apoiador.cpf"], ["ufcity", "tour.apoiador.ufcity"], ["consent", "tour.apoiador.consent"], ["submit", "tour.apoiador.submit"]],
  estrangeiro: [["email", "tour.estrangeiro.email"], ["country", "tour.estrangeiro.country"], ["university", "tour.estrangeiro.university"], ["consent", "tour.estrangeiro.consent"], ["submit", "tour.estrangeiro.submit"]],
};
const STEP_MS = 5000, GAP_MS = 350;

/** Tour com setas amarelas (não modal). Dispara por `peticao:tour` {category, force}. Sem `force`, só no 1º acesso do IP / após atualização do site. */
export default function Tour() {
  const { t } = useI18n();
  const [tip, setTip] = useState<{ text: string; left: number; top: number; up: boolean; ax: number; n: number; total: number } | null>(null);
  const run = useRef(0);

  useEffect(() => {
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    /** O tour só começa depois que a janela de apresentação do app (boas-vindas) for fechada. */
    const welcomeClosed = () => new Promise<void>((resolve) => {
      if (!document.querySelector("dialog.welcome[open]")) return resolve();
      const done = () => { window.removeEventListener("peticao:welcome-closed", done); clearInterval(poll); setTimeout(resolve, 500); };
      const poll = setInterval(() => { if (!document.querySelector("dialog.welcome[open]")) done(); }, 400);
      window.addEventListener("peticao:welcome-closed", done);
    });
    async function start(cat: Cat, force: boolean) {
      const id = ++run.current;
      await welcomeClosed();
      if (run.current !== id) return;
      if (!force) {
        try {
          const ver = (await (await fetch("/api/tour", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ category: cat }) })).json()) as { show: boolean; version?: string };
          const key = `tour:${ver.version}:${cat}`;
          let seenHere = false; try { seenHere = !!localStorage.getItem(key); } catch { /* sem armazenamento */ }
          if (!ver.show || seenHere) return;
          try { localStorage.setItem(key, "1"); } catch { /* ok */ }
        } catch { return; }
      }
      if (run.current !== id) return;
      const steps = STEPS[cat];
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      for (let k = 0; k < steps.length; k++) {
        if (run.current !== id) return;
        const el = [...document.querySelectorAll<HTMLElement>(`[data-tour="${steps[k][0]}"]`)].find((e) => e.getClientRects().length > 0);
        if (!el) continue;
        el.scrollIntoView({ block: "center", behavior: reduced ? "auto" : "smooth" });
        await wait(reduced ? 50 : 450);
        const place = () => {
          const r = el.getBoundingClientRect(), w = Math.min(250, innerWidth - 16);
          const up = r.bottom + 110 > innerHeight && r.top > 120;
          const left = Math.max(8, Math.min(r.left + 24, innerWidth - w - 8));
          setTip({ text: t(steps[k][1]), left, top: up ? r.top - 10 : r.bottom + 10, up, ax: Math.max(14, Math.min(r.left + 30 - left, w - 30)), n: k + 1, total: steps.length });
        };
        if (run.current !== id) return;
        place();
        const onMove = () => { if (run.current === id) place(); };
        addEventListener("scroll", onMove, true); addEventListener("resize", onMove);
        try { await wait(STEP_MS); } finally { removeEventListener("scroll", onMove, true); removeEventListener("resize", onMove); }
        if (run.current !== id) return;
        setTip(null); await wait(GAP_MS);
      }
      if (run.current === id) setTip(null);
    }
    const on = (e: Event) => { const d = (e as CustomEvent).detail as { category: Cat; force?: boolean }; if (d?.category in STEPS) void start(d.category, !!d.force); };
    window.addEventListener("peticao:tour", on);
    return () => { window.removeEventListener("peticao:tour", on); run.current++; };
  }, [t]);

  return (
    <>
      <div className="sr-only" role="status" aria-live="polite">{tip?.text ?? ""}</div>
      {tip && <div className={`tour-tip${tip.up ? " up" : ""}`} style={{ left: tip.left, top: tip.top, ["--ax" as string]: `${tip.ax}px` }} aria-hidden="true">
      <svg className="tour-arrow" viewBox="0 0 24 24" width="30" height="30" aria-hidden="true"><path d="M12 2 2 14h6v8h8v-8h6L12 2z" fill="#f5c518" stroke="#7a5f00" strokeWidth="1.2" strokeLinejoin="round" /></svg>
      <span className="tour-text">{tip.text}</span>
      <small>{tip.n}/{tip.total}</small>
    </div>}
    </>
  );
}
