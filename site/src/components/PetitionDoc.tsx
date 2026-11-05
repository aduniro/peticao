"use client";
import { useEffect, useState } from "react";
import { Rich } from "./Rich";
import { useI18n } from "@/i18n/client";
import { countryName } from "@/i18n";
import type { Doc } from "@/content/peticao";

/** Texto da petição no idioma da tela. Para estrangeiros (categoria escolhida no formulário) mostra a versão própria, com o país da instituição. */
export default function PetitionDoc({ br, est, version }: { br: Doc; est: Doc; version: string }) {
  const { t, lang, country: ipCountry } = useI18n();
  const [ctx, setCtx] = useState<{ category: string; country: string }>({ category: ipCountry !== "BR" ? "estrangeiro" : "servidor", country: ipCountry !== "BR" ? ipCountry : "" });
  useEffect(() => {
    const on = (e: Event) => setCtx((e as CustomEvent).detail);
    window.addEventListener("peticao:ctx", on);
    return () => window.removeEventListener("peticao:ctx", on);
  }, []);
  const foreign = ctx.category === "estrangeiro";
  const d = foreign ? est : br;
  const where = ctx.country ? t("doc.where.one", { c: countryName(ctx.country, lang) }) : t("doc.noCountry").replace(/^\((.*)\)$/, "$1"); // sem parênteses duplos
  return (
    <article className="doc" id="peticao">
      <p className="dest"><strong>{t("doc.recipient")}</strong> {d.recipient}<br /><strong>{t("doc.copies")}</strong> {d.copies}</p>
      <p>{d.salutation}</p>
      {d.intro.map((p, i) => <p key={i}>{p.replace("{where}", where)}</p>)}
      <h2>{d.reasonsTitle}</h2>
      <ol className="reasons">{d.reasons.map((r, i) => <li key={i}><Rich text={r} /></li>)}</ol>
      <h2>{d.requestTitle}</h2>
      <p><Rich text={d.request} /></p>
      <p>{d.closing}</p>
      <p><strong>{d.signedBy}</strong></p>
      <p className="small">{t("doc.version")} <code>{version}</code></p>
    </article>
  );
}
