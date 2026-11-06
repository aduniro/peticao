import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import { terminalAte, terminalConfigurado } from "@/lib/terminal";
import Terminal from "@/components/admin/Terminal";

export const dynamic = "force-dynamic";
export const metadata = { title: "Terminal", robots: { index: false } };

export default async function TerminalPagina() {
  const s = await sessaoAdmin();
  if (!s) redirect("/admin");
  if (!nivelOk(s.nivel, "total")) redirect("/admin?erro=nivel");
  if (!stepupValido(s)) redirect("/admin/confirmar?volta=/admin/terminal");
  const ate = await terminalAte();
  return (
    <main>
      <p><a href="/admin">← Painel</a> · <a href="/admin/acoes">Central de Ações</a></p>
      <h1>Terminal</h1>
      {!terminalConfigurado() ? <p className="box err" role="alert">O serviço do Terminal ainda não foi instalado neste servidor (deploy/22-terminal.sh).</p>
        : !ate ? <p className="box">O Terminal está <strong>desligado</strong>. Para ligar, use a Central de Ações → "Ligar o Terminal" (liga por tempo limitado e desliga sozinho).</p>
        : <Terminal ate={ate.toISOString()} />}
      <p className="small">Este terminal roda sem privilégios de administrador, sem acesso às senhas do site e sem acesso à internet. Cada comando fica registrado com o seu nome. O que precisar de administrador continua indo por e-mail para você rodar.</p>
    </main>
  );
}
