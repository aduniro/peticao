"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { DDI_LISTA, bandeira } from "@/lib/whatsapp/ddi";
import { countryName } from "@/i18n";
import { useI18n } from "@/i18n/client";

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
export type Fone = { iso: string; ddi: string; numero: string };

/** Número com DDI: fechado mostra bandeira + número; aberto lista bandeira, DDI e país (busca por país ou DDI). Padrão Brasil +55. Quem digita "+351…" troca o país sozinho. */
export default function PhoneField({ value, onChange, error }: { value: Fone; onChange: (v: Fone) => void; error?: string }) {
  const { t, lang } = useI18n();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fora = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", fora); return () => document.removeEventListener("mousedown", fora);
  }, []);
  const itens = useMemo(() => DDI_LISTA.map(([iso, ddi]) => ({ iso, ddi, nome: countryName(iso, lang) })), [lang]);
  const lista = useMemo(() => {
    const n = norm(q.trim()), d = q.replace(/\D/g, "");
    return n ? itens.filter((i) => norm(i.nome).includes(n) || (d && i.ddi.startsWith(d))) : itens;
  }, [q, itens]);
  const escolher = (i: { iso: string; ddi: string }) => { onChange({ ...value, iso: i.iso, ddi: i.ddi }); setOpen(false); setQ(""); };
  function digitar(v: string) {
    const mais = v.trimStart().startsWith("+");
    if (mais) {
      // "+DDI número": assim que há dígitos além do DDI, o país troca sozinho (também ao digitar, não só ao colar)
      const d = v.replace(/\D/g, "");
      for (const len of [3, 2, 1]) {
        const hit = itens.find((i) => i.ddi === d.slice(0, len));
        if (hit && d.length > len) return onChange({ iso: hit.iso, ddi: hit.ddi, numero: d.slice(len) });
      }
    }
    onChange({ ...value, numero: (mais ? "+" : "") + v.replace(/[^\d\s().-]/g, "") });
  }
  return (
    <div className="phone" ref={box} role="group" aria-labelledby="wa-label">
      <div className="phone-row">
        <button type="button" className="phone-ddi" aria-haspopup="listbox" aria-expanded={open} aria-label={t("f.whatsappDdi")} onClick={() => setOpen(!open)}>
          <span aria-hidden="true">{bandeira(value.iso)}</span> <span>+{value.ddi}</span> <span aria-hidden="true">▾</span>
        </button>
        <input name="whatsapp" type="tel" inputMode="tel" autoComplete="tel-national" placeholder={value.ddi === "55" ? "69 99999-0000" : ""} aria-label={t("f.whatsappNumber")} aria-invalid={!!error} value={value.numero} onChange={(e) => digitar(e.target.value)} />
      </div>
      {open ? (
        <div className="phone-list" role="listbox" aria-label={t("f.whatsappDdi")}>
          <input type="search" autoFocus placeholder={t("f.whatsappSearch")} aria-label={t("f.whatsappSearch")} value={q} onChange={(e) => setQ(e.target.value)} />
          <ul>
            {lista.map((i) => (
              <li key={i.iso}><button type="button" role="option" aria-selected={i.iso === value.iso} onClick={() => escolher(i)}><span aria-hidden="true">{bandeira(i.iso)}</span> <b>+{i.ddi}</b> <span>{i.nome}</span></button></li>
            ))}
            {lista.length === 0 ? <li className="small">—</li> : null}
          </ul>
        </div>
      ) : null}
      {error ? <span className="err">{error}</span> : null}
    </div>
  );
}
