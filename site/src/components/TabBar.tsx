"use client";
import { useEffect, useState } from "react";
import { useI18n } from "@/i18n/client";

type Tab = "inicio" | "peticao" | "assinar" | "contato" | "compartilhar";

/** Barra inferior estilo app nativo (só no celular): Início · Petição · Assinar · Contato · Compartilhar. */
export default function TabBar() {
  const { t } = useI18n();
  const [tab, setTab] = useState<Tab>("inicio");
  const home = () => typeof location !== "undefined" && location.pathname === "/";
  const fire = (what: string) => window.dispatchEvent(new CustomEvent("peticao:open", { detail: what }));
  const goDoc = () => document.getElementById("peticao")?.scrollIntoView({ behavior: "smooth", block: "start" });

  useEffect(() => {
    if (location.pathname === "/contato") setTab("contato");
    let sheet: "sign" | "share" | null = null, raf = 0;
    const place = () => {
      raf = 0;
      if (sheet) return;
      if (!home()) { if (location.pathname !== "/contato") setTab("inicio"); return; }
      const d = document.getElementById("peticao");
      const r = d?.getBoundingClientRect();
      setTab(r && r.top < innerHeight * 0.45 && r.bottom > innerHeight * 0.3 ? "peticao" : "inicio");
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(place); };
    const onOpen = (e: Event) => {
      const d = (e as CustomEvent).detail;
      sheet = d === "sign" || d === "share" ? d : null;
      if (sheet) setTab(sheet === "sign" ? "assinar" : "compartilhar"); else place();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("peticao:open", onOpen);
    place();
    return () => { window.removeEventListener("scroll", onScroll); window.removeEventListener("peticao:open", onOpen); if (raf) cancelAnimationFrame(raf); };
  }, []);

  const click = (id: Tab) => {
    if (id === "inicio") { if (!home()) { location.href = "/"; return; } fire("none"); window.scrollTo({ top: 0, behavior: "smooth" }); setTab("inicio"); }
    else if (id === "peticao") { if (!home()) { location.href = "/#peticao"; return; } fire("none"); setTab("peticao"); setTimeout(goDoc, 60); }
    else if (id === "assinar") { if (!home()) { location.href = "/#assinar"; return; } setTab("assinar"); fire("sign"); }
    else if (id === "contato") { location.href = "/contato"; }
    else { setTab("compartilhar"); fire("share"); }
  };
  const Item = ({ id, label, children }: { id: Tab; label: string; children: React.ReactNode }) => (
    <button type="button" className={tab === id ? "on" : ""} aria-current={tab === id ? "page" : undefined} data-track={`tab-${id}`} onClick={() => click(id)}>
      {children}<span>{label}</span>
    </button>
  );
  const svg = (d: string) => <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><path fill="currentColor" d={d} /></svg>;
  return (
    <nav className="tabbar" aria-label="Menu">
      <Item id="inicio" label={t("tab.home")}>{svg("M12 3 2 12h3v8h5v-6h4v6h5v-8h3L12 3z")}</Item>
      <Item id="peticao" label={t("tab.petition")}>{svg("M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5L14 3.5zM8 12v2h8v-2H8zm0 4v2h6v-2H8z")}</Item>
      <Item id="assinar" label={t("tab.sign")}>{svg("M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zM20.7 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z")}</Item>
      <Item id="contato" label={t("tab.contact")}>{svg("M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 2v.5l8 5 8-5V6H4zm16 3-8 5-8-5v9h16V9z")}</Item>
      <Item id="compartilhar" label={t("tab.share")}>{svg("M18 16a3 3 0 0 0-2.4 1.2L8.9 13.3a3 3 0 0 0 0-2.6l6.7-3.9A3 3 0 1 0 15 5.6L8.4 9.5a3 3 0 1 0 0 5l6.6 3.9A3 3 0 1 0 18 16z")}</Item>
    </nav>
  );
}
