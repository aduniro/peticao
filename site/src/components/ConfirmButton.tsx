"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

export default function ConfirmButton({ token }: { token: string }) {
  const { t } = useI18n();
  const [r, setR] = useState<"idle" | "loading" | "ok" | "invalid" | "expired">("idle");
  const [panel, setPanel] = useState<string | null>(null);
  async function go() {
    setR("loading");
    const res = await fetch("/api/confirmar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
    const d = await res.json().catch(() => ({ result: "invalid" }));
    setPanel(d.panel ?? null);
    setR(d.result);
  }
  useEffect(() => { if (r === "ok" && panel) { const t = setTimeout(() => { window.location.href = panel; }, 1800); return () => clearTimeout(t); } }, [r, panel]);
  if (r === "ok") return <div className="box ok"><h2>{t("confirm.ok")}</h2><p>{t("confirm.okText")} {panel && <a href={panel}>{t("confirm.openNow")}</a>}</p></div>;
  if (r === "expired") return <div className="box"><h2>{t("confirm.expired")}</h2><p>{t("confirm.expiredText")}</p></div>;
  if (r === "invalid") return <div className="box"><h2>{t("confirm.invalid")}</h2><p>{t("confirm.invalidText")}</p></div>;
  return <button className="primary" onClick={go} disabled={r === "loading"}>{r === "loading" ? t("confirm.loading") : t("confirm.button")}</button>;
}
