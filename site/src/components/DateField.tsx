"use client";
import { useEffect, useId, useRef, useState } from "react";
import { maskBirth, parseBirth } from "@/lib/birth";
import { useI18n } from "@/i18n/client";

const pad = (n: number) => String(n).padStart(2, "0");

/** Data com máscara (dd/mm/aaaa), digitável, e calendário em dropdown com seleção de mês e ano. */
export default function DateField({ value, onChange, label, invalid = false, describedBy }: { value: string; onChange: (v: string) => void; label: string; invalid?: boolean; describedBy?: string }) {
  const { t } = useI18n();
  const MONTHS = t("date.months").split(","), WEEK = t("date.weekdays").split(",");
  const id = useId();
  const [open, setOpen] = useState(false);
  const now = new Date();
  const parsed = parseBirth(value);
  const [view, setView] = useState({ y: parsed?.y ?? 1985, m: parsed ? parsed.m - 1 : 0 });
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const first = new Date(view.y, view.m, 1).getDay();
  const days = new Date(view.y, view.m + 1, 0).getDate();
  const cells = [...Array(first).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const years = Array.from({ length: now.getFullYear() - 1899 }, (_, i) => now.getFullYear() - i);

  const pick = (d: number) => { onChange(`${pad(d)}/${pad(view.m + 1)}/${view.y}`); setOpen(false); };
  const future = (d: number) => new Date(view.y, view.m, d) > now;

  return (
    <div className="datefield" ref={box} onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); setOpen(false); } }}>
      <label htmlFor={id}>{label}</label>
      <div className="date-input">
        <input id={id} inputMode="numeric" autoComplete="bday" placeholder={t("date.placeholder")} maxLength={10} value={value} aria-invalid={invalid} aria-describedby={describedBy}
          onChange={(e) => onChange(maskBirth(e.target.value))} />
        <button type="button" className="icon-btn" aria-label={t("date.open")} aria-expanded={open} onClick={() => { if (parsed) setView({ y: parsed.y, m: parsed.m - 1 }); setOpen((o) => !o); }}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path fill="currentColor" d="M7 2v2H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2h-2V2h-2v2H9V2H7zm12 8v9H5v-9h14zM7 12v2h2v-2H7zm4 0v2h2v-2h-2z" /></svg>
        </button>
      </div>
      {open && (
        <div className="calendar" role="dialog" aria-label={t("date.choose")}>
          <div className="cal-head">
            <select aria-label={t("date.month")} value={view.m} onChange={(e) => setView({ ...view, m: Number(e.target.value) })}>
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
            <select aria-label={t("date.year")} value={view.y} onChange={(e) => setView({ ...view, y: Number(e.target.value) })}>
              {years.map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
          <div className="cal-grid" role="grid">
            {WEEK.map((w, i) => <span key={i} className="cal-wd" aria-hidden="true">{w}</span>)}
            {cells.map((d, i) => d === null ? <span key={`e${i}`} /> : (
              <button type="button" key={d} disabled={future(d)} className={parsed && parsed.d === d && parsed.m - 1 === view.m && parsed.y === view.y ? "sel" : ""} onClick={() => pick(d)}>{d}</button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
