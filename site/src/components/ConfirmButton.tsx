"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";
import { signupStatusCopy } from "@/lib/signup-status-copy";
import { boundedJsonRequest } from "@/lib/bounded-json-request";

export default function ConfirmButton({ token }: { token: string }) {
  const { t,lang } = useI18n();
  const [r, setR] = useState<"idle" | "loading" | "ok" | "invalid" | "expired" | "network">("idle");
  const [panel, setPanel] = useState<string | null>(null);
  async function go() {
    setR("loading");
    try {
      const {response:res,data:d} = await boundedJsonRequest("/api/confirmar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) });
      if (!res.ok || !['ok','invalid','expired'].includes(d?.result)) throw new Error('confirmation_unavailable');
      setPanel(typeof d.panel==='string' && d.panel.startsWith('/meu/') ? d.panel : null);
      setR(d.result);
    } catch {setR('network');}
  }
  useEffect(() => { if (r === "ok" && panel) { const t = setTimeout(() => { window.location.href = panel; }, 1800); return () => clearTimeout(t); } }, [r, panel]);
  if (r === "ok") return <div className="box ok"><h2>{t("confirm.ok")}</h2><p>{t("confirm.okText")} {panel && <a href={panel}>{t("confirm.openNow")}</a>}</p></div>;
  if (r === "expired") return <div className="box"><h2>{t("confirm.expired")}</h2><p>{t("confirm.expiredText")}</p></div>;
  if (r === "invalid") return <div className="box"><h2>{t("confirm.invalid")}</h2><p>{t("confirm.invalidText")}</p></div>;
  return <>{r==='network' && <p role="alert">{signupStatusCopy(lang,'network')}</p>}<button className="primary" onClick={go} disabled={r === "loading"}>{r === "loading" ? t("confirm.loading") : t("confirm.button")}</button></>;
}
