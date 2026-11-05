"use client";
import { useEffect, useRef, useState } from "react";
import { useLive, type LiveData } from "@/lib/live-client";
import { useI18n } from "@/i18n/client";
import type { T } from "@/i18n/messages-types";
import Flag from "./Flag";

/** "agora", "há 3 min", "3 min ago"… no idioma da tela. */
export function relative(iso: string, now: number, t: T): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 45) return t("time.now");
  const m = Math.round(s / 60);
  if (m < 60) return t("time.min", { n: m });
  const h = Math.round(m / 60);
  if (h < 24) return t("time.hour", { n: h });
  const d = Math.round(h / 24);
  return t(d === 1 ? "time.day.one" : "time.day.other", { n: d });
}

/** "Últimas assinaturas" ao vivo: bandeira, só o primeiro nome e o rótulo (sigla da IFES, apoiador ou universidade estrangeira). */
export default function LiveFeed({ initial }: { initial: LiveData }) {
  const { t } = useI18n();
  const { items } = useLive(initial);
  const [now, setNow] = useState(() => Date.now());
  const seen = useRef(new Set(initial.items.map((i) => i.id)));
  const fresh = new Set(items.filter((i) => !seen.current.has(i.id)).map((i) => i.id));
  useEffect(() => { items.forEach((i) => seen.current.add(i.id)); });
  useEffect(() => { const x = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(x); }, []);
  const shown = items.slice(0, 6);
  const label = (i: (typeof items)[number]) => (i.kind === "servidor" ? i.ifes ?? t("cat.servidor") : i.kind === "apoiador" ? t("feed.supporter") : t("feed.foreignUni"));
  return (
    <section className="feed" aria-labelledby="feed-title">
      <header><h2 id="feed-title">{t("feed.title")}</h2><span className="live" aria-hidden="true"><i /> {t("feed.live")}</span></header>
      {shown.length === 0 ? <p className="small">{t("feed.empty")}</p> : (
        <ul aria-live="polite" aria-relevant="additions">
          {shown.map((i) => (
            <li key={i.id} className={fresh.has(i.id) ? "new" : ""}>
              <Flag code={i.flag} size={28} />
              <span className="who"><strong>{i.who}</strong><small>{label(i)}</small></span>
              <time dateTime={i.at}>{relative(i.at, now, t)}</time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
