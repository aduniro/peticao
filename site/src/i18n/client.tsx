"use client";
import { createContext, useContext, useMemo } from "react";
import type { Locale } from "./index";
import { makeT, type Messages, type T } from "./messages-types";

type Ctx = { lang: Locale; country: string; t: T; messages: Messages };
const I18nCtx = createContext<Ctx | null>(null);

export function I18nProvider({ lang, country, messages, children }: { lang: Locale; country: string; messages: Messages; children: React.ReactNode }) {
  const v = useMemo(() => ({ lang, country, messages, t: makeT(messages) }), [lang, country, messages]);
  return <I18nCtx.Provider value={v}>{children}</I18nCtx.Provider>;
}
export function useI18n(): Ctx {
  const c = useContext(I18nCtx);
  if (!c) throw new Error("useI18n fora do I18nProvider");
  return c;
}
