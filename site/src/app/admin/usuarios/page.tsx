import { redirect } from "next/navigation";
import { sessaoAdmin } from "@/lib/admin";
import { NIVEIS, ROTULO_NIVEL, listarUsuarios, nivelOk, stepupValido } from "@/lib/admin-users";
import { brasilia } from "@/lib/time";

export const dynamic = "force-dynamic";
export const metadata = { title: "Usuários do painel", robots: { index: false } };

const MSG: Record<string, string> = { criado: "Usuário criado. Enviamos um convite por e-mail para a pessoa criar a própria senha (vale 24 horas).", nivel: "Nível alterado.", ativado: "Usuário ativado.", desativado: "Usuário desativado e sessões encerradas.", link_enviado: "Link de redefinição enviado por e-mail." };
const ERRO: Record<string, string> = {
  email_invalido: "E-mail inválido.", nome_invalido: "Informe o nome (2 a 120 caracteres).", nivel_invalido: "Nível inválido.", email_ja_existe: "Já existe um usuário com esse e-mail.",
  ultimo_total: "Não é possível: o painel não pode ficar sem nenhum usuário ativo de nível Total.", nao_existe: "Usuário não encontrado.", acao_invalida: "Ação inválida.",
};
const DESC: Record<string, string> = { leitura: "vê consultas e estatísticas", edicao: "corrige cadastros, e-mails, domínios e filas; vê dados de contato", exclusao: "remove dados (reservado: hoje nenhuma tela remove)", total: "tudo: lotes, envio ao Governo, WhatsApp, usuários" };

export default async function Usuarios({ searchParams }: { searchParams: { erro?: string; msg?: string } }) {
  const s = await sessaoAdmin();
  if (!s) redirect("/admin");
  if (!nivelOk(s.nivel, "total")) redirect("/admin?erro=nivel");
  if (!stepupValido(s)) redirect("/admin/confirmar?volta=/admin/usuarios");
  const usuarios = await listarUsuarios();
  return (
    <main className="v2-pagina">
      <div className="v2-secao">
      <h1>Usuários do painel</h1>
      {searchParams.msg && MSG[searchParams.msg] ? <p className="box ok" role="status">{MSG[searchParams.msg]}</p> : null}
      {searchParams.erro ? <p className="box err" role="alert">{ERRO[searchParams.erro] ?? "Não foi possível concluir."}</p> : null}
      <p className="small">Os níveis incluem os de baixo: {NIVEIS.map((n) => `${ROTULO_NIVEL[n]} (${DESC[n]})`).join(" · ")}.</p>
      <div style={{ overflowX: "auto" }}>
        <table className="adm-table">
          <thead><tr><th>Nome</th><th>E-mail</th><th>Nível</th><th>Situação</th><th>Último acesso</th><th>Ações</th></tr></thead>
          <tbody>
            {usuarios.map((u) => (
              <tr key={u.id}>
                <td>{u.nome}</td><td>{u.email}</td>
                <td>
                  <form method="post" action="/api/admin/usuarios" style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 220 }}>
                    <input type="hidden" name="acao" value="nivel" /><input type="hidden" name="id" value={u.id} />
                    <select name="nivel" defaultValue={u.nivel} style={{ minWidth: 120, width: "auto", flex: "1 1 120px" }}>{NIVEIS.map((n) => <option key={n} value={n}>{ROTULO_NIVEL[n]}</option>)}</select><button>Salvar</button>
                  </form>
                </td>
                <td>{u.ativo ? "ativo" : "desativado"}{u.trocarSenha ? " · precisa trocar a senha" : ""}</td>
                <td>{u.ultimoAcesso ? brasilia(u.ultimoAcesso) : "nunca"}</td>
                <td><div style={{ display: "flex", gap: 4, flexWrap: "wrap", minWidth: 200 }}>
                  <form method="post" action="/api/admin/usuarios" style={{ display: "inline" }}><input type="hidden" name="acao" value={u.ativo ? "desativar" : "ativar"} /><input type="hidden" name="id" value={u.id} /><button>{u.ativo ? "Desativar" : "Ativar"}</button></form>
                  {u.ativo ? <form method="post" action="/api/admin/usuarios" style={{ display: "inline" }}><input type="hidden" name="acao" value="redefinir" /><input type="hidden" name="id" value={u.id} /><button>Enviar link de nova senha</button></form> : null}
                </div></td>
              </tr>
            ))}
            {!usuarios.length ? <tr><td colSpan={6}>Nenhum usuário cadastrado: o painel ainda usa a senha única de transição.</td></tr> : null}
          </tbody>
        </table>
      </div>
      <h2>Novo usuário</h2>
      <form method="post" action="/api/admin/usuarios" className="form" style={{ maxWidth: 460 }}>
        <input type="hidden" name="acao" value="criar" />
        <label>Nome<input name="nome" required minLength={2} maxLength={120} /></label>
        <label>E-mail<input type="email" name="email" required autoCapitalize="none" spellCheck={false} /></label>
        <label>Nível<select name="nivel" defaultValue="leitura">{NIVEIS.map((n) => <option key={n} value={n}>{ROTULO_NIVEL[n]}</option>)}</select></label>
        <p className="small">A pessoa recebe um e-mail com um link para criar a própria senha. Nenhuma senha é enviada nem mostrada.</p>
        <button>Criar e enviar o convite</button>
      </form>
    </div>
    </main>
  );
}
