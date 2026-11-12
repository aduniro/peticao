import type { Metadata, Viewport } from "next";
import { sessaoAdmin } from "@/lib/admin";
import { ROTULO_NIVEL, nivelOk } from "@/lib/admin-users";
import Shell from "@/components/admin/shell/Shell";
import { config } from "@/lib/config";
import "./admin.css";
import "./v2.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "Painel", template: "%s · Painel" }, robots: { index: false, follow: false }, manifest: "/admin-manifest.webmanifest", appleWebApp: { capable: true, title: "Painel PLV 12", statusBarStyle: "black-translucent" } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#05382a" };

/** Moldura do painel (trilho e flyout no computador, gaveta e barra inferior no celular). Sem sessão, mostra só a tela de acesso. O nível do usuário vem da sessão no banco; o Shell só esconde itens, quem barra de verdade é cada página e rota. */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const s = await sessaoAdmin();
  if (!s) return <>{children}</>;
  return <Shell quem={{ nome: s.nome, nivel: s.nivel, rotuloNivel: ROTULO_NIVEL[s.nivel] }} ehTotal={nivelOk(s.nivel, "total")} publicUrl={config.appUrl()} materialsEnabled={process.env.MATERIALS_LIBRARY_ENABLED === "1" && s.userId > 0 && !!s.sessaoId && !s.trocarSenha}>{children}</Shell>;
}
