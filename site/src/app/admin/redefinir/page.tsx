import LoginMoldura from "@/components/admin/LoginMoldura";
import CampoSenha from "@/components/admin/CampoSenha";
export const dynamic = "force-dynamic";
// "same-origin": o link com o token nunca vaza para outro site pelo cabeçalho Referer, MAS o formulário continua enviando o Origin verdadeiro.
// ("no-referrer" faria o navegador enviar "Origin: null" em todo POST, e a rota recusaria a redefinição.)
export const metadata = { title: "Criar nova senha", robots: { index: false }, referrer: "same-origin" as const };

const ERRO: Record<string, string> = {
  token: "Este link é inválido ou já foi usado ou expirou. Peça outro em \"Esqueci minha senha\".",
  diferentes: "As duas senhas não são iguais.",
  limite: "Muitas tentativas. Aguarde alguns minutos.",
  origem: "Não foi possível enviar o formulário. Recarregue a página.",
};

export default function Redefinir({ searchParams }: { searchParams: { token?: string; erro?: string; d?: string } }) {
  const token = searchParams.token ?? "";
  const erro = searchParams.erro === "fraca" ? searchParams.d || "Escolha uma senha mais forte." : searchParams.erro ? ERRO[searchParams.erro] : null;
  return (
    <LoginMoldura titulo="Criar a nova senha" pe={<a href="/admin">← Voltar ao acesso</a>}>
      {!token ? <p className="err" role="alert">{ERRO.token}</p> : (
        <form method="post" action="/api/admin/redefinir">
          <input type="hidden" name="token" value={token} />
          <label>Nova senha<CampoSenha name="senha" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          <label>Repita a nova senha<CampoSenha name="senha2" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          <p className="v2-login-sub">Use pelo menos 12 caracteres. Evite o seu e-mail e senhas comuns.</p>
          {erro ? <p className="err" role="alert">{erro}</p> : null}
          <button className="v2-login-btn">Salvar a nova senha</button>
        </form>
      )}
    </LoginMoldura>
  );
}
