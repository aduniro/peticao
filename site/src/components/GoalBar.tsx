"use client";
import { useLive, type LiveData } from "@/lib/live-client";
import { useI18n } from "@/i18n/client";

/** Barra de progresso até a meta; a cada `batch` assinaturas uma versão segue ao Governo. */
export default function GoalBar({ initial, goal, batch }: { initial: LiveData; goal: number; batch: number }) {
  const { t, lang } = useI18n();
  const n = useLive(initial).counts.total;
  const nf = new Intl.NumberFormat(lang === "pt" ? "pt-BR" : lang);
  const pct = Math.min(100, (n / goal) * 100);
  const toNext = batch - (n % batch);
  return (
    <div className="goal" aria-live="polite">
      <div className="goal-head"><strong>{t("goal.progress", { n: nf.format(n), goal: nf.format(goal) })}</strong></div>
      <div className="goal-track" role="progressbar" aria-valuemin={0} aria-valuemax={goal} aria-valuenow={Math.min(n, goal)}><i style={{ width: `${pct}%` }} /></div>
      <small>{n >= goal ? t("goal.done") : t("goal.next", { n: nf.format(toNext) })}</small>
    </div>
  );
}
