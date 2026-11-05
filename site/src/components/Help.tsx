"use client";
import { useEffect, useId, useRef, useState } from "react";
import { useI18n } from "@/i18n/client";

/** Bolinha "?" com tooltip (passar o mouse, focar com o teclado ou tocar). O balão fica dentro da tela. */
export default function Help({ text, label }: { text: string; label?: string }) {
  const { t } = useI18n();
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);
  const place = () => {
    const r = btn.current?.getBoundingClientRect(); if (!r) return;
    const w = Math.min(260, innerWidth - 16);
    const left = Math.max(8, Math.min(r.left + r.width / 2 - w / 2, innerWidth - w - 8));
    const up = r.bottom + 120 > innerHeight && r.top > 130;
    setPos({ left, top: up ? r.top - 8 : r.bottom + 8, up });
  };
  useEffect(() => {
    if (!open) return;
    place();
    const off = (e: Event) => { if (!btn.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", off); document.addEventListener("keydown", esc); addEventListener("scroll", place, true); addEventListener("resize", place);
    return () => { document.removeEventListener("pointerdown", off); document.removeEventListener("keydown", esc); removeEventListener("scroll", place, true); removeEventListener("resize", place); };
  }, [open]);
  return (
    <span className="help" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button ref={btn} type="button" className="help-btn" aria-label={label ?? t("help.label")} aria-describedby={open ? id : undefined} aria-expanded={open}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((o) => !o); }} onFocus={() => setOpen(true)} onBlur={() => setOpen(false)}>?</button>
      {open && pos && <span role="tooltip" id={id} className={`help-tip${pos.up ? " up" : ""}`} style={{ left: pos.left, top: pos.top }}>{text}</span>}
    </span>
  );
}
