"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import styles from "./subscriber.module.css";

type Signature = {
  id: number; seq: number | null; name: string; email: string;
  category: "servidor" | "apoiador" | "estrangeiro";
  institution?: string | null; role?: string | null; campus?: string | null;
  city?: string | null; uf?: string | null; regionDeclared?: boolean;
  institutionalEmailVerified?: boolean; createdAt?: string | null; confirmedAt?: string | null;
};
type Account = { authenticated: true; signature: Signature; revision: string };
type Mode = "login" | "forgot" | "reset" | "confirm";

async function request(action: string, data?: Record<string, unknown>) {
  const response = await fetch(`/api/assinante/${action}`, data === undefined
    ? { cache: "no-store", credentials: "same-origin" }
    : { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(data) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.ok === false) throw new Error(result.message || result.error || result.erro || (response.status === 404 ? "Este recurso ainda não está disponível." : "Não foi possível concluir. Tente novamente."));
  return result;
}

function PasswordField({ label, name, fresh = false }: { label: string; name: string; fresh?: boolean }) {
  const [visible, setVisible] = useState(false);
  return <label className={styles.field}>{label}<span className={styles.password}>
    <input type={visible ? "text" : "password"} name={name} required minLength={fresh ? 15 : undefined} maxLength={200} autoComplete={fresh ? "new-password" : "current-password"} />
    <button type="button" onClick={() => setVisible(!visible)} aria-label={visible ? "Ocultar senha" : "Mostrar senha"} aria-pressed={visible}>{visible ? "Ocultar" : "Mostrar"}</button>
  </span></label>;
}

function Modal({ title, children, confirm, close, busy = false }: { title: string; children: React.ReactNode; confirm?: () => void; close: () => void; busy?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={styles.modal} onCancel={(event) => { event.preventDefault(); if (!busy) close(); }} aria-labelledby="subscriber-modal-title">
    <h2 id="subscriber-modal-title">{title}</h2>{children}<div className={styles.actions}>
      {confirm ? <button type="button" className={styles.primary} onClick={confirm} disabled={busy}>{busy ? "Salvando…" : "Confirmar"}</button> : null}
      <button type="button" onClick={close} disabled={busy}>{confirm ? "Cancelar" : "Continuar"}</button>
    </div>
  </dialog>;
}

function NewPassword({ resetToken, onSuccess }: { resetToken?: string; onSuccess: (message: string) => void }) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState<{ password: string; passwordConfirmation: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const form = useRef<HTMLFormElement>(null);
  async function save() {
    if (!pending) return;
    setBusy(true); setError("");
    try {
      await request(resetToken === undefined ? "password" : "reset", { ...pending, ...(resetToken === undefined ? {} : { token: resetToken }) });
      setPending(null); form.current?.reset(); onSuccess("A nova senha foi salva. Ela não tem vencimento. Entre novamente com a senha atual.");
    } catch (e) { setPending(null); setError(e instanceof Error ? e.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <><form ref={form} onSubmit={(event) => {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const password = String(data.get("password") || ""), passwordConfirmation = String(data.get("passwordConfirmation") || "");
    if (password !== passwordConfirmation) { setError("As duas senhas não são iguais. Confira os campos."); return; }
    if (password.length < 15) { setError("Use pelo menos 15 caracteres. Você pode usar uma frase."); return; }
    setError(""); setPending({ password, passwordConfirmation });
  }}>
    <PasswordField label="Nova senha" name="password" fresh />
    <PasswordField label="Repita a nova senha" name="passwordConfirmation" fresh />
    <p className={styles.hint}>Use pelo menos 15 caracteres. Você pode colar uma senha ou usar uma frase. A senha não vence e não precisa ser trocada periodicamente.</p>
    {error ? <p className={styles.error} role="alert">{error}</p> : null}
    <button className={styles.primary} disabled={busy}>Salvar nova senha</button>
  </form>{pending ? <Modal title="Confirmar nova senha" confirm={save} busy={busy} close={() => setPending(null)}><p>Deseja substituir a senha atual? Depois de salvar, use a nova senha para entrar.</p></Modal> : null}</>;
}

function AccessForm({ onLogin }: { onLogin: (account: Account) => void }) {
  const [mode, setMode] = useState<"email" | "cpf">("email"), [enroll, setEnroll] = useState(false);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(""); setMessage("");
    try {
      if (enroll) { await request("enroll", { email: String(data.get("email") || "") }); setMessage("Se houver assinatura confirmada para esse e-mail, as orientações de acesso serão enviadas ao endereço já cadastrado. Confira também o spam."); }
      else {
        await request("login", { mode, email: String(data.get("email") || ""), name: String(data.get("name") || ""), cpf: String(data.get("cpf") || ""), password: String(data.get("password") || "") });
        const account = await request("me"); if (!account.authenticated) throw new Error("Não foi possível abrir a sessão. Tente novamente."); onLogin(account);
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível entrar."); } finally { setBusy(false); }
  }
  return <><h1>{enroll ? "Primeiro acesso" : "Verificar/Corrigir minha assinatura"}</h1>
    <p className={styles.sub}>{enroll ? "Receba sua senha inicial no e-mail já confirmado da assinatura." : "Entre para conferir sua assinatura e solicitar correções com segurança."}</p>
    {!enroll ? <div className={styles.tabs} role="group" aria-label="Como entrar"><button type="button" aria-pressed={mode === "email"} onClick={() => { setMode("email"); setError(""); }}>E-mail e senha</button><button type="button" aria-pressed={mode === "cpf"} onClick={() => { setMode("cpf"); setError(""); }}>Nome, CPF e senha</button></div> : null}
    <form key={`${mode}-${enroll}`} onSubmit={submit}>
      {enroll || mode === "email" ? <label className={styles.field}>E-mail da assinatura<input type="email" name="email" maxLength={200} autoComplete="username" autoCapitalize="none" spellCheck={false} required /></label> : <><label className={styles.field}>Nome completo<input name="name" maxLength={200} autoComplete="name" required /></label><label className={styles.field}>CPF<input name="cpf" inputMode="numeric" maxLength={14} autoComplete="off" required placeholder="000.000.000-00" /></label></>}
      {!enroll ? <PasswordField label="Senha atual" name="password" /> : <p className={styles.hint}>A senha inicial não tem vencimento nem troca obrigatória. O link abre esta página; a senha é informada separadamente. CPF, nascimento e nome da mãe não substituem sua senha.</p>}
      {error ? <p role="alert" className={styles.error}>{error}</p> : null}{message ? <p role="status" className={styles.notice}>{message}</p> : null}
      <button className={styles.primary} disabled={busy}>{busy ? "Aguarde…" : enroll ? "Receber orientações de acesso" : "Entrar"}</button>
    </form>
    <div className={styles.links}><button type="button" className={styles.textButton} onClick={() => { setEnroll(!enroll); setError(""); setMessage(""); }}>{enroll ? "Já tenho senha: voltar ao acesso" : "Primeiro acesso: receber minha senha"}</button><a href="/minha-assinatura/esqueci">Esqueci minha senha</a></div>
  </>;
}

function Dashboard({ account, onLogout, onSuccess }: { account: Account; onLogout: () => void; onSuccess: (message: string) => void }) {
  const s = account.signature;
  const [category, setCategory] = useState(s.category), [password, setPassword] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  async function change(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(""); setMessage("");
    try { await request("change", { revision: account.revision, category, institution: String(data.get("institution") || ""), role: String(data.get("role") || ""), campus: String(data.get("campus") || ""), city: String(data.get("city") || ""), uf: String(data.get("uf") || ""), regionDeclared: data.get("regionDeclared") === "on" }); setMessage("Se a solicitação puder ser processada, a confirmação será enviada ao e-mail já vinculado. Os dados atuais permanecem até você confirmar a alteração."); }
    catch (e) { setError(e instanceof Error ? e.message : "Não foi possível solicitar a correção."); } finally { setBusy(false); }
  }
  return <><div className={styles.dashboardHeading}><div><span className={styles.eyebrow}>MINHA ASSINATURA</span><h1>{s.name}</h1></div><button type="button" disabled={busy} onClick={async () => { setBusy(true); try { await request("logout", {}); onLogout(); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível sair."); } finally { setBusy(false); } }}>Sair</button></div>
    <dl className={styles.summary}><div><dt>Inscrição</dt><dd>{s.seq ?? "Não atribuída"}</dd></div><div><dt>E-mail vinculado</dt><dd>{s.email}</dd></div><div><dt>E-mail institucional</dt><dd>{s.institutionalEmailVerified ? "Verificado" : "Não verificado"}</dd></div></dl>
    <p className={styles.hint}>A correção mantém seu registro e as datas originais. A categoria declarada e a verificação do e-mail institucional são informações diferentes.</p>
    <h2>Solicitar correção dos dados</h2><form onSubmit={change}>
      <label className={styles.field}>Categoria<select name="category" value={category} onChange={(e) => setCategory(e.target.value as Signature["category"])} disabled={s.category === "estrangeiro"}><option value="apoiador">Apoiador(a)</option><option value="servidor">Servidor(a)</option>{s.category === "estrangeiro" ? <option value="estrangeiro">Exterior</option> : null}</select></label>
      <div key={category}>{category === "servidor" ? <><label className={styles.field}>Instituição<input name="institution" defaultValue={s.institution || ""} maxLength={160} required /></label><label className={styles.field}>Cargo<select name="role" defaultValue={s.role || ""} required><option value="">Selecione</option><option value="docente">Docente</option><option value="tae">Técnico-administrativo em educação</option></select></label><label className={styles.field}>Campus<input name="campus" defaultValue={s.campus || ""} maxLength={120} /></label><label className={styles.checkbox}><input type="checkbox" name="regionDeclared" defaultChecked={Boolean(s.regionDeclared)} />Declaro lotação na Amazônia Legal ou na faixa de fronteira</label><p className={styles.hint}>Se seu e-mail institucional apresentou problemas, o e-mail pessoal confirmado pode ser mantido. Isso não equivale à verificação do vínculo institucional.</p></> : category === "apoiador" ? <><label className={styles.field}>Cidade<input name="city" defaultValue={s.city || ""} maxLength={100} required /></label><label className={styles.field}>UF<select name="uf" defaultValue={s.uf || ""} required><option value="">Selecione</option>{"AC AL AP AM BA CE DF ES GO MA MT MS MG PA PB PR PE PI RJ RN RS RO RR SC SP SE TO".split(" ").map(uf => <option key={uf}>{uf}</option>)}</select></label></> : <p className={styles.notice}>Para corrigir os dados deste cadastro, entre em contato com a organização.</p>}</div>
      {error ? <p className={styles.error} role="alert">{error}</p> : null}{message ? <p className={styles.notice} role="status">{message}</p> : null}
      {category !== "estrangeiro" ? <button className={styles.primary} disabled={busy}>{busy ? "Aguarde…" : "Solicitar confirmação da correção por e-mail"}</button> : null}
    </form><section className={styles.passwordSection}><h2>Sua senha</h2><button type="button" className={styles.textButton} onClick={() => setPassword(!password)} aria-expanded={password}>{password ? "Fechar alteração de senha" : "Trocar minha senha (opcional)"}</button>{password ? <NewPassword onSuccess={onSuccess} /> : null}</section>
  </>;
}

export default function SubscriberAccess({ mode = "login" }: { mode?: Mode }) {
  const [account, setAccount] = useState<Account | null>(null), [loading, setLoading] = useState(mode === "login"), [token, setToken] = useState("");
  const tokenRead = useRef(false);
  const [ready, setReady] = useState(mode === "login" || mode === "forgot"), [error, setError] = useState(""), [message, setMessage] = useState(""), [success, setSuccess] = useState(""), [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    if ((mode === "reset" || mode === "confirm") && !tokenRead.current) {
      tokenRead.current = true;
      const parsed = new URLSearchParams(window.location.hash.slice(1)); setToken(parsed.get("token") || ""); window.history.replaceState(null, "", window.location.pathname); setReady(true);
    }
    if (mode === "login") request("me").then(value => { if (alive && value.authenticated) setAccount(value); }).catch(() => {}).finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [mode]);
  function passwordSuccess(text: string) { setAccount(null); setSuccess(text); }
  return <main className={styles.page}><section className={`${styles.card} ${account ? styles.wide : ""}`}><div className={styles.brand}><span aria-hidden="true">✓</span><div><b>PLV 12/2026</b><small>Área do assinante</small></div></div>
    {loading ? <p role="status">Conferindo sua sessão…</p> : mode === "login" ? account ? <Dashboard account={account} onLogout={() => setAccount(null)} onSuccess={passwordSuccess} /> : <AccessForm onLogin={setAccount} /> : mode === "forgot" ? <><h1>Recuperar minha senha</h1><p className={styles.sub}>Confirme o acesso ao e-mail da assinatura para escolher uma nova senha. A senha atual continua válida até a conclusão.</p><form onSubmit={async (event) => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(""); try { await request("forgot", { email: String(data.get("email") || "") }); setMessage("Se houver cadastro compatível, as orientações serão enviadas ao e-mail já vinculado. Confira também o spam."); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível solicitar."); } finally { setBusy(false); } }}><label className={styles.field}>E-mail da assinatura<input name="email" type="email" autoComplete="email" maxLength={200} required /></label>{error ? <p className={styles.error} role="alert">{error}</p> : null}{message ? <p className={styles.notice} role="status">{message}</p> : null}<button className={styles.primary} disabled={busy}>{busy ? "Aguarde…" : "Receber instruções"}</button></form></> : mode === "reset" ? <><h1>Escolher nova senha</h1>{!ready ? <p>Conferindo link…</p> : token ? <NewPassword resetToken={token} onSuccess={passwordSuccess} /> : <p className={styles.error} role="alert">Este link não contém uma autorização de recuperação. Solicite um novo em “Esqueci minha senha”.</p>}</> : <><h1>Confirmar correção da assinatura</h1><p className={styles.sub}>Confirme somente se você solicitou esta alteração. Abrir esta página não altera o cadastro.</p>{ready && token ? <button className={styles.primary} disabled={busy || Boolean(message)} onClick={async () => { setBusy(true); setError(""); try { await request("confirm-change", { token }); setMessage("A alteração foi confirmada. As datas originais da assinatura foram preservadas."); setToken(""); } catch (e) { setError(e instanceof Error ? e.message : "Não foi possível confirmar."); } finally { setBusy(false); } }}>{busy ? "Confirmando…" : "Confirmar alteração solicitada"}</button> : !message ? <p className={styles.error}>O link está incompleto. Use a mensagem enviada ao seu e-mail.</p> : null}{message ? <p className={styles.notice} role="status">{message}</p> : null}{error ? <p className={styles.error} role="alert">{error}</p> : null}</>}
    <footer className={styles.footer}>{mode !== "login" ? <a href="/minha-assinatura">Voltar ao acesso da assinatura</a> : <a href="/">Voltar à petição</a>}</footer>
  </section>{success ? <Modal title="Senha salva" close={() => { setSuccess(""); if (mode !== "login") window.location.assign("/minha-assinatura"); }}><p>{success}</p></Modal> : null}</main>;
}
