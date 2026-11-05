"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";

type Ev = { type: string; path?: string; target?: string; label?: string };
const optedOut = () => navigator.doNotTrack === "1" || (navigator as unknown as { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
const sid = () => { try { let s = sessionStorage.getItem("sid"); if (!s) { s = Math.random().toString(36).slice(2) + Date.now().toString(36); sessionStorage.setItem("sid", s); } return s; } catch { return undefined; } };

function send(events: Ev[]) {
  if (optedOut() || location.pathname.startsWith("/admin") || location.pathname.startsWith("/dev")) return;
  const body = JSON.stringify({ events, path: location.pathname, sid: sid(), lang: navigator.language, screen: `${screen.width}x${screen.height}` });
  if (!navigator.sendBeacon?.("/api/evento", new Blob([body], { type: "application/json" }))) fetch("/api/evento", { method: "POST", body, keepalive: true }).catch(() => {});
}

/** Registra visitas, cliques e o início do formulário (respeita Do Not Track / Global Privacy Control). */
export default function Tracker() {
  const path = usePathname();
  useEffect(() => { send([{ type: "pageview", path }]); }, [path]);
  useEffect(() => {
    let started = false;
    const click = (e: MouseEvent) => {
      const el = (e.target as HTMLElement | null)?.closest<HTMLElement>("a,button,[data-track]");
      if (!el) return;
      send([{ type: el.dataset.event ?? "click", target: el.dataset.track ?? el.id ?? el.tagName.toLowerCase(), label: (el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 60) }]);
    };
    const focus = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      if (!started && t?.closest("form.form") && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) { started = true; send([{ type: "form_start" }]); }
    };
    const custom = (e: Event) => send([{ type: (e as CustomEvent).detail?.type ?? "click" }]);
    document.addEventListener("click", click, true);
    document.addEventListener("focusin", focus);
    window.addEventListener("peticao:event", custom);
    return () => { document.removeEventListener("click", click, true); document.removeEventListener("focusin", focus); window.removeEventListener("peticao:event", custom); };
  }, []);
  return null;
}
