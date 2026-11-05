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
    <main className="narrow">
      <h1>Criar a nova senha</h1>
      {!token ? <p className="err" role="alert">{ERRO.token}</p> : (
        <form method="post" action="/api/admin/redefinir" className="form">
          <input type="hidden" name="token" value={token} />
          <label>Nova senha<input type="password" name="senha" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          <label>Repita a nova senha<input type="password" name="senha2" required minLength={12} maxLength={200} autoComplete="new-password" /></label>
          <p className="small">Use pelo menos 12 caracteres. Evite o seu e-mail e senhas comuns.</p>
          {erro ? <p className="err" role="alert">{erro}</p> : null}
          <button>Salvar a nova senha</button>
        </form>
      )}
      <p style={{ marginTop: 12 }}><a href="/admin">← Voltar ao acesso</a></p>
    </main>
  );
}
