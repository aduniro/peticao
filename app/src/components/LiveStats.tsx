"use client";
import { useI18n } from "@/i18n/client";
import { useLive, type LiveData } from "@/lib/live-client";

export default function LiveStats({ initial }: { initial: LiveData }) {
  const { t } = useI18n();
  const { counts: c } = useLive(initial);
  return (
    <div className="stats hero-stats" aria-live="polite">
      <div><strong>{c.total}</strong><span>{t(c.total === 1 ? "stats.signatures.one" : "stats.signatures.other")}</span></div>
      <div><strong>{c.servidor}</strong><span>{t("stats.servers")}</span></div>
      <div><strong>{c.apoiador}</strong><span>{t(c.apoiador === 1 ? "stats.supporters.one" : "stats.supporters.other")}</span></div>
      <div><strong>{c.estrangeiro}</strong><span>{t("stats.foreign")}</span></div>
    </div>
  );
}
