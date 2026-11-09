"use client";
import { useEffect, useId, useRef, useState } from "react";

export type Option = { key: string; label: string; hint?: string; flag?: string };

/** Campo digitável com lista de sugestões (teclado: setas, Enter, Esc). O texto continua livre; escolher uma sugestão chama onPick. */
export default function Combobox({ value, onChange, onPick, options, placeholder, name, invalid, disabled, required, emptyText, ariaLabel, autoComplete = "off", openOnFocus = true, inputMode }: {
  value: string; onChange: (v: string) => void; onPick: (o: Option) => void; options: Option[]; placeholder?: string; name?: string;
  invalid?: boolean; disabled?: boolean; required?: boolean; emptyText?: string; ariaLabel?: string; autoComplete?: string; openOnFocus?: boolean; inputMode?: "text" | "search";
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const off = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", off); return () => document.removeEventListener("mousedown", off);
  }, []);
  useEffect(() => { setActive(-1); }, [options]);
  useEffect(() => { if (active >= 0) list.current?.children[active]?.scrollIntoView({ block: "nearest" }); }, [active]);
  const pick = (o: Option) => { onPick(o); setOpen(false); };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((a) => Math.min(a + 1, options.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter" && open && active >= 0 && options[active]) { e.preventDefault(); pick(options[active]); }
    else if (e.key === "Escape") { setOpen(false); }
  };
  return (
    <div className="combo" ref={root}>
      <input name={name} value={value} placeholder={placeholder} disabled={disabled} required={required} aria-required={required || undefined} aria-invalid={invalid || undefined} aria-label={ariaLabel}
        role="combobox" aria-expanded={open} aria-controls={`${id}-l`} aria-autocomplete="list" aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
        autoComplete={autoComplete} autoCapitalize="none" spellCheck={false} inputMode={inputMode}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }} onFocus={() => openOnFocus && setOpen(true)} onKeyDown={onKey} />
      <span className="combo-caret" aria-hidden="true">▾</span>
      {open && !disabled && (
        <ul id={`${id}-l`} role="listbox" ref={list} className="combo-list">
          {options.length === 0 ? (emptyText ? <li className="combo-empty" role="presentation">{emptyText}</li> : null) : options.map((o, i) => (
            <li key={o.key} id={`${id}-${i}`} role="option" aria-selected={i === active} className={i === active ? "on" : ""}
              onMouseDown={(e) => { e.preventDefault(); pick(o); }} onMouseEnter={() => setActive(i)}>
              {o.flag && <img src={`/flags/${o.flag}.svg`} alt="" width={20} height={15} loading="lazy" />}
              <span>{o.label}</span>{o.hint && <small>{o.hint}</small>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
