import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { ROTULO_NIVEL } from "@/lib/admin-users";

export const dynamic = "force-dynamic";
export const metadata = { title: "Minha conta", robots: { index: false } };

const ERRO: Record<string, string> = { atual: "A senha atual não confere.", diferentes: "As duas senhas novas não são iguais.", semconta: "Este acesso não tem conta de usuário para trocar a senha." };

export default async function Conta({ searchParams }: { searchParams: { erro?: string; msg?: string; d?: string } }) {
  const s = await sessaoAdmin();
  if (!s) redirect("/admin");
  const erro = searchParams.erro === "fraca" ? searchParams.d || "Escolha uma senha mais forte." : searchParams.erro ? ERRO[searchParams.erro] : null;
  return (
    <main>
      <p><a href="/admin">← Painel</a></p>
      <h1>Minha conta</h1>
      <table className="adm-table"><tbody>
        <tr><td>Nome</td><td>{s.nome}</td></tr><tr><td>E-mail</td><td>{s.email}</td></tr><tr><td>Nível de acesso</td><td><strong>{ROTULO_NIVEL[s.nivel]}</strong></td></tr>
      </tbody></table>
      {s.trocarSenha ? <p className="box err" role="alert">Por segurança, troque a sua senha agora.</p> : null}
      {searchParams.msg === "ok" ? <p className="box ok" role="status">Senha trocada.</p> : null}
      {s.userId ? (
        <form method="post" action="/api/admin/conta" className="form" style={{ maxWidth: 420 }}>
          <h2>Trocar a senha</h2>
          <label>Senha atual<input type="password" name="atual" required autoComplete="current-password" /></label>
          <label>Nova senha<input type="password" name="nova" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          <label>Repita a nova senha<input type="password" name="nova2" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          <p className="small">Pelo menos 12 caracteres. Ao trocar, as outras sessões abertas continuam; para encerrar todas, use "Esqueci minha senha".</p>
          {erro ? <p className="err" role="alert">{erro}</p> : null}
          <button>Trocar a senha</button>
        </form>
      ) : <p className="small">{ERRO.semconta}</p>}
    </main>
  );
}
