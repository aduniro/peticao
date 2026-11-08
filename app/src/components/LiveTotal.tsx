"use client";
import { useI18n } from "@/i18n/client";
import { useLive, type LiveData } from "@/lib/live-client";

/** Total de assinaturas confirmadas, atualizado ao vivo. */
export default function LiveTotal({ initial }: { initial: LiveData }) {
  const { t } = useI18n();
  const n = useLive(initial).counts.total;
  return <p className="live-total" aria-live="polite"><strong>{n}</strong> {t(n === 1 ? "my.totalOne" : "my.totalOther")}</p>;
}
