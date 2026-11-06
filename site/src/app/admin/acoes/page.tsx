import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { nivelOk, stepupValido } from "@/lib/admin-users";
import { ACOES } from "@/lib/acoes";
import Acoes from "@/components/admin/Acoes";

export const dynamic = "force-dynamic";
export const metadata = { title: "Central de Ações", robots: { index: false } };

export default async function AcoesPagina() {
  const s = await sessaoAdmin();
  if (!s) redirect("/admin");
  if (!nivelOk(s.nivel, "total")) redirect("/admin?erro=nivel");
  if (!stepupValido(s)) redirect("/admin/confirmar?volta=/admin/acoes");
  const lista = ACOES.map((a) => ({ id: a.id, grupo: a.grupo, titulo: a.titulo, palavra: a.palavra ?? null, efeito: a.validar({}).ok ? a.descrever((a.validar({}) as any).p) : "" }));
  return (
    <main>
      <p><a href="/admin">← Painel</a></p>
      <h1>Central de Ações</h1>
      <p className="small">Cada botão faz uma coisa fixa e fica registrado (quem, quando, o quê). Primeiro "Simular" mostra o que aconteceria sem mudar nada; só depois "Executar", digitando a palavra de confirmação.</p>
      <Acoes acoes={lista} />
    </main>
  );
}
