/** Tela inteira das páginas de acesso do painel (login, esqueci, redefinir): marca, cartão central e o mesmo visual escuro do painel. */
export default function LoginMoldura({ titulo, sub, children, pe }: { titulo: string; sub?: string; children: React.ReactNode; pe?: React.ReactNode }) {
  return (
    <main className="v2-login">
      <div className="v2-login-cartao">
        <div className="v2-login-marca">
          <i aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3l8 3v6c0 4.5-3.2 8.2-8 9-4.8-.8-8-4.5-8-9V6z" /><path d="M9 12l2.2 2.2L15.5 10" /></svg></i>
          <div><b>PLV 12/2026</b><small>Painel da campanha</small></div>
        </div>
        <h1>{titulo}</h1>
        {sub ? <p className="v2-login-sub">{sub}</p> : null}
        {children}
        {pe ? <p className="v2-login-pe">{pe}</p> : null}
      </div>
    </main>
  );
}
