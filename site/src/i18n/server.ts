import { cookies, headers } from "next/headers";
import { isLocale, langForCountry, type Locale } from "./index";
import { isCountryCode } from "./countries";
import { DICTS, makeT } from "./messages";
import { lookupIp } from "@/lib/geo";
import { clientIp } from "@/lib/net";

/** Idioma e país da visita: cookies `lang`/`ctry` (escolha da pessoa) → país do IP → inglês quando o país não tem idioma entre os 5. País e idioma são independentes. */
export async function getI18n() {
  const jar = cookies();
  let country = jar.get("ctry")?.value?.toUpperCase() ?? "";
  if (!isCountryCode(country)) {
    country = "";
    try { country = (await lookupIp(clientIp(headers()))).country?.toUpperCase() ?? ""; } catch { /* sem base de IP */ }
    if (!isCountryCode(country)) country = "BR";
  }
  const c = jar.get("lang")?.value;
  const lang: Locale = isLocale(c) ? c : langForCountry(country);
  const messages = DICTS[lang];
  return { lang, country, messages, t: makeT(messages) };
}
