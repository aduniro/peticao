"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

export default function CookieNotice() {
  const { t } = useI18n();
  const [show, setShow] = useState(false);
  useEffect(() => { try { if (!localStorage.getItem("cn1")) setShow(true); } catch { /* sem armazenamento */ } }, []);
  if (!show) return null;
  return (
    <div className="cookie" role="region" aria-label={t("footer.privacy")}>
      <p>{t("cookie.text")} <a href="/privacidade">{t("cookie.more")}</a>.</p>
      <button type="button" onClick={() => { try { localStorage.setItem("cn1", "1"); } catch { /* ok */ } setShow(false); }}>{t("cookie.ok")}</button>
    </div>
  );
}
