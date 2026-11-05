"use client";
import { usePathname } from "next/navigation";
import TabBar from "./TabBar";
import ShareSheet from "./ShareSheet";
import CookieNotice from "./CookieNotice";
import Tour from "./Tour";

/** Elementos de "app" das páginas públicas. Painéis administrativos e ferramentas de desenvolvimento ficam de fora. */
export default function PublicChrome() {
  const p = usePathname() ?? "";
  if (p.startsWith("/admin") || p.startsWith("/dev")) return null;
  return (<><TabBar /><ShareSheet /><CookieNotice /><Tour /></>);
}
