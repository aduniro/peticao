"use client";
import { useEffect, useRef, useState } from "react";
import { CAPAS } from "@/content/capas";
import { useI18n } from "@/i18n/client";

/** Tempo padrão de carrosséis em apps/sites: 5 s por imagem; pausa ao passar o mouse, focar ou tocar, e com a aba oculta. */
const INTERVAL_MS = 5000;
const SIZES = "(min-width: 1132px) 1100px, 100vw";
const set = (n: number) => [640, 1080, 1600].map((w) => `/capa/opcoes/opcao-${n}-${w}.webp ${w}w`).join(", ");

/** Carrossel com as opções de capa, para a ADUNIR escolher. Com `choice` definido, mostra só a capa escolhida (sem controles). */
export default function CoverCarousel({ choice }: { choice?: number | null }) {
  const { t } = useI18n();
  const items = choice ? CAPAS.filter((c) => c.n === choice) : CAPAS;
  const track = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [reduced, setReduced] = useState(false);
  const go = (n: number) => {
    const el = track.current; if (!el) return;
    const k = (n + items.length) % items.length;
    el.scrollTo({ left: k * el.clientWidth, behavior: "smooth" }); setI(k);
  };
  useEffect(() => {
    const el = track.current; if (!el) return;
    const on = () => setI(Math.round(el.scrollLeft / el.clientWidth));
    el.addEventListener("scroll", on, { passive: true }); return () => el.removeEventListener("scroll", on);
  }, []);
  useEffect(() => {
    setReduced(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false);
    const vis = () => setHidden(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", vis); vis();
    return () => document.removeEventListener("visibilitychange", vis);
  }, []);
  // Avança sozinho; o contador reinicia a cada troca (inclusive manual), então setas e bolinhas "adiantam" o temporizador.
  useEffect(() => {
    if (items.length < 2 || paused || hidden || reduced) return;
    const h = setTimeout(() => go(i + 1), INTERVAL_MS);
    return () => clearTimeout(h);
  }, [i, paused, hidden, reduced, items.length]); // eslint-disable-line react-hooks/exhaustive-deps
  if (items.length === 1) {
    return <figure className="cover"><img src={`/capa/opcoes/opcao-${items[0].n}-1080.webp`} srcSet={set(items[0].n)} sizes={SIZES} width={items[0].w} height={items[0].h} decoding="async" fetchPriority="high" alt={t("cover.alt")} /></figure>;
  }
  return (
    <section className="cover carousel" aria-roledescription="carousel" aria-label={t("cover.label")} tabIndex={0}
      onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onFocus={() => setPaused(true)} onBlur={() => setPaused(false)}
      onTouchStart={() => setPaused(true)} onTouchEnd={() => setTimeout(() => setPaused(false), 4000)}
      onKeyDown={(e) => { if (e.key === "ArrowRight") { e.preventDefault(); go(i + 1); } else if (e.key === "ArrowLeft") { e.preventDefault(); go(i - 1); } }}>
      <div className="car-track" ref={track} aria-live={paused || reduced ? "polite" : "off"}>
        {items.map((c, k) => (
          <figure key={c.n} className="car-slide" aria-roledescription="slide" aria-label={t("cover.option", { n: c.n, total: items.length })}>
            <img src={`/capa/opcoes/opcao-${c.n}-1080.webp`} srcSet={set(c.n)} sizes={SIZES} width={c.w} height={c.h}
              loading={k === 0 ? "eager" : "lazy"} fetchPriority={k === 0 ? "high" : "auto"} decoding="async" alt={`${t("cover.alt")} (${t("cover.option", { n: c.n, total: items.length })})`} />
          </figure>
        ))}
      </div>
      <span className="car-badge" aria-live="polite">{t("cover.option", { n: items[i]?.n ?? 1, total: items.length })}{items[i]?.atual ? ` · ${t("cover.current")}` : ""}</span>
      <button type="button" className="car-btn prev" onClick={() => go(i - 1)} aria-label={t("cover.prev")} data-track="capa-anterior">‹</button>
      <button type="button" className="car-btn next" onClick={() => go(i + 1)} aria-label={t("cover.next")} data-track="capa-proxima">›</button>
      {!paused && !hidden && !reduced && <span key={i} className="car-progress" style={{ animationDuration: `${INTERVAL_MS}ms` }} aria-hidden="true" />}
      <div className="car-dots" role="tablist" aria-label={t("cover.label")}>
        {items.map((c, k) => <button key={c.n} type="button" role="tab" aria-selected={k === i} aria-label={t("cover.option", { n: c.n, total: items.length })} className={k === i ? "on" : ""} onClick={() => go(k)} />)}
      </div>
    </section>
  );
}
