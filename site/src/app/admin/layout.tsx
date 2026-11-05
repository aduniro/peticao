import type { Metadata, Viewport } from "next";
import { isAdmin } from "@/lib/admin";
import Shell from "@/components/admin/shell/Shell";
import "./admin.css";
import "./v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Painel", template: "%s · Painel" }, robots: { index: false, follow: false }, manifest: "/admin-manifest.webmanifest", appleWebApp: { capable: true, title: "Painel PLV 12", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#05382a" };

/** Moldura do painel: menu lateral no computador, barra superior no tablet e abas inferiores no celular. Sem sessão, mostra só a tela de acesso. */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!isAdmin()) return <>{children}</>;
  return <Shell>{children}</Shell>;
}
