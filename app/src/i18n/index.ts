import { isCountryCode } from "./countries";

export const LOCALES = ["pt", "es", "en", "fr", "de"] as const;
export type Locale = (typeof LOCALES)[number];
export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

export const LOCALE_INFO: Record<Locale, { name: string; flag: string; intl: string }> = {
  pt: { name: "Português (Brasil)", flag: "br", intl: "pt-BR" },
  es: { name: "Español", flag: "es", intl: "es" },
  en: { name: "English", flag: "gb", intl: "en" },
  fr: { name: "Français", flag: "fr", intl: "fr" },
  de: { name: "Deutsch", flag: "de", intl: "de" },
};

/** País → idioma oficial (entre os 5 disponíveis). Países de vários idiomas (CH, BE, CA, LU) abrem no mais falado; a pessoa pode trocar. Sem idioma oficial entre os 5 → inglês. */
const BY_LANG: Record<Locale, string> = {
  pt: "BR PT AO MZ CV GW ST TL",
  es: "ES MX AR CO CL PE VE EC GT CU BO DO HN PY SV NI CR PA UY PR GQ",
  fr: "FR BE LU MC HT SN CI ML BF NE TG BJ GA CG CD CM MG DJ KM CF TD GN BI RW SC VU NC PF RE GP MQ GF YT PM WF BL MF",
  de: "DE AT LI CH",
  en: "",
};
const COUNTRY_LANG = new Map<string, Locale>();
for (const l of LOCALES) for (const c of BY_LANG[l].split(" ").filter(Boolean)) COUNTRY_LANG.set(c, l);
export const langForCountry = (country: string | null | undefined): Locale => (country ? COUNTRY_LANG.get(country.toUpperCase()) ?? "en" : "en");

/** Nome do país no idioma da tela (Intl.DisplayNames). */
const dn = new Map<Locale, Intl.DisplayNames>();
export function countryName(code: string, lang: Locale): string {
  if (!isCountryCode(code)) return code;
  if (!dn.has(lang)) dn.set(lang, new Intl.DisplayNames([LOCALE_INFO[lang].intl], { type: "region" }));
  return dn.get(lang)!.of(code.toUpperCase()) ?? code;
}

/** Substitui {chave} por valores. */
export const fmt = (s: string, vars: Record<string, string | number> = {}) => s.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : `{${k}}`));
