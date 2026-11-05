import { createHash, randomBytes } from "node:crypto";
import { audit, query } from "./db";
import { hmac } from "./security";
import { SAFE_EMAIL_RE } from "./email-syntax";
import { HASH_FALSO, gerarSenha, hashSenha, problemaNaSenha, verificarHash } from "./senha";

/**
 * Usuários do painel, com quatro níveis (cada um inclui os de baixo): leitura < edição < exclusão < total.
 * Sessão guardada no banco (só o hash do token), com validade e revogável na hora; senha scrypt; bloqueio após 5 erros; redefinição por e-mail.
 * A senha única antiga (lib/admin.ts) só vale enquanto NÃO existir nenhum usuário (ver `temUsuarios`).
 */
export const NIVEIS = ["leitura", "edicao", "exclusao", "total"] as const;
export type Nivel = (typeof NIVEIS)[number];
export const ROTULO_NIVEL: Record<Nivel, string> = { leitura: "Leitura", edicao: "Edição", exclusao: "Exclusão", total: "Total" };
export const nivelOk = (tem: Nivel, exige: Nivel) => NIVEIS.indexOf(tem) >= NIVEIS.indexOf(exige);
export const ehNivel = (x: unknown): x is Nivel => typeof x === "string" && (NIVEIS as readonly string[]).includes(x);

export const SESSAO_HORAS = 4, RESET_MINUTOS = 30, CONVITE_MINUTOS = 24 * 60, MAX_FALHAS = 5, BLOQUEIO_MINUTOS = 15;

export type Usuario = { id: number; email: string; nome: string; nivel: Nivel; ativo: boolean; trocarSenha: boolean; criadoEm: string; ultimoAcesso: string | null };
export type SessaoAdmin = { userId: number; email: string; nome: string; nivel: Nivel; sessaoId: number | null; legado: boolean; preview: boolean; stepupAte: Date | null; trocarSenha: boolean };

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const normEmail = (e: string) => e.trim().toLowerCase();
const doUsuario = (r: any): Usuario => ({ id: r.id, email: r.email, nome: r.nome, nivel: r.nivel, ativo: r.ativo, trocarSenha: r.trocar_senha, criadoEm: new Date(r.criado_em).toISOString(), ultimoAcesso: r.ultimo_acesso ? new Date(r.ultimo_acesso).toISOString() : null });

/** Já existe algum usuário cadastrado? Enquanto não existir, vale a senha única antiga. Falha no banco conta como "existe" (nunca libera a senha antiga por engano). */
export async function temUsuarios(): Promise<boolean> {
  try { return (await query<{ e: boolean }>("SELECT EXISTS(SELECT 1 FROM admin_users) e")).rows[0].e; } catch { return true; }
}

export type ResultadoCriar = { ok: true; usuario: Usuario; senhaGerada: string | null } | { ok: false; erro: "email_invalido" | "nome_invalido" | "nivel_invalido" | "email_ja_existe" | "senha_fraca"; detalhe?: string };
export async function criarUsuario(o: { email: string; nome: string; nivel: Nivel; senha?: string; trocarSenha?: boolean; por?: string }): Promise<ResultadoCriar> {
  const email = normEmail(o.email), nome = o.nome.replace(/\s+/g, " ").trim();
  if (!SAFE_EMAIL_RE.test(email)) return { ok: false, erro: "email_invalido" };
  if (nome.length < 2 || nome.length > 120) return { ok: false, erro: "nome_invalido" };
  if (!ehNivel(o.nivel)) return { ok: false, erro: "nivel_invalido" };
  const senha = o.senha ?? gerarSenha();
  const fraca = o.senha ? problemaNaSenha(senha, email) : null;
  if (fraca) return { ok: false, erro: "senha_fraca", detalhe: fraca };
  try {
    const r = await query("INSERT INTO admin_users(email,nome,nivel,senha_hash,trocar_senha) VALUES($1,$2,$3,$4,$5) RETURNING *", [email, nome, o.nivel, hashSenha(senha), o.trocarSenha ?? !o.senha]);
    const usuario = doUsuario(r.rows[0]);
    await audit("admin_usuario_criado", null, { id: usuario.id, nivel: usuario.nivel, por: o.por ?? "cli" });
    return { ok: true, usuario, senhaGerada: o.senha ? null : senha };
  } catch (e: any) {
    if (e?.code === "23505") return { ok: false, erro: "email_ja_existe" };
    throw e;
  }
}

export type ResultadoAuth = { ok: true; usuario: Usuario } | { ok: false; motivo: "credenciais" | "bloqueado" };
/** Confere e-mail e senha. Gasta o mesmo tempo com e-mail inexistente (não revela quem tem conta). 5 erros seguidos bloqueiam a conta por 15 minutos. */
export async function autenticar(email: string, senha: string): Promise<ResultadoAuth> {
  const r = await query<any>("SELECT * FROM admin_users WHERE email=$1", [normEmail(email)]);
  const u = r.rows[0];
  const confere = verificarHash(senha, u?.senha_hash ?? HASH_FALSO);
  if (!u || !u.ativo) return { ok: false, motivo: "credenciais" };
  if (u.bloqueado_ate && new Date(u.bloqueado_ate) > new Date()) return { ok: false, motivo: "bloqueado" };
  if (!confere) {
    const falhas = u.falhas + 1;
    if (falhas >= MAX_FALHAS) {
      await query(`UPDATE admin_users SET falhas=0, bloqueado_ate=now() + ($2 || ' minutes')::interval WHERE id=$1`, [u.id, String(BLOQUEIO_MINUTOS)]);
      await audit("admin_usuario_bloqueado", null, { id: u.id });
      return { ok: false, motivo: "bloqueado" };
    }
    await query("UPDATE admin_users SET falhas=$2 WHERE id=$1", [u.id, falhas]);
    return { ok: false, motivo: "credenciais" };
  }
  await query("UPDATE admin_users SET falhas=0, bloqueado_ate=NULL, ultimo_acesso=now() WHERE id=$1", [u.id]);
  return { ok: true, usuario: doUsuario(u) };
}

export async function abrirSessao(userId: number, ip: string): Promise<{ token: string; expira: Date }> {
  const token = randomBytes(32).toString("base64url"), expira = new Date(Date.now() + SESSAO_HORAS * 3600_000);
  await query("INSERT INTO admin_sessions(token_hash,user_id,expira_em,ip_hash) VALUES($1,$2,$3,$4)", [sha(token), userId, expira, hmac("ip:" + ip).slice(0, 16)]);
  await query("DELETE FROM admin_sessions WHERE expira_em < now() - interval '1 day'");
  return { token, expira };
}

/** Sessão válida (não expirada, usuário ativo) ou null. O nível vem SEMPRE do banco, então mudar o nível ou desativar o usuário vale na hora. */
export async function sessaoPorToken(token: string): Promise<SessaoAdmin | null> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return null;
  const r = await query<any>(
    `SELECT s.id sid, s.stepup_ate, u.id uid, u.email, u.nome, u.nivel, u.trocar_senha FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id
     WHERE s.token_hash=$1 AND s.expira_em > now() AND u.ativo`, [sha(token)]);
  const x = r.rows[0];
  return x ? { userId: x.uid, email: x.email, nome: x.nome, nivel: x.nivel, sessaoId: x.sid, legado: false, preview: false, stepupAte: x.stepup_ate ? new Date(x.stepup_ate) : null, trocarSenha: x.trocar_senha } : null;
}
export const encerrarSessao = async (token: string) => { if (token) await query("DELETE FROM admin_sessions WHERE token_hash=$1", [sha(token)]); };
export const encerrarSessoesDoUsuario = async (userId: number) => { await query("DELETE FROM admin_sessions WHERE user_id=$1", [userId]); };

// ---- redefinição de senha por e-mail ----
export type EnviarEmail = (m: { to: string; subject: string; text: string; html: string }) => Promise<unknown>;
async function enviarPadrao(m: { to: string; subject: string; text: string; html: string }) { const { sendMail } = await import("./mail"); await sendMail(m, "admin"); }

/** Pede a redefinição: se o e-mail tem conta ativa, manda um link de uso único (30 min). Nunca revela se a conta existe. No máximo 3 pedidos por hora por conta. */
export async function pedirReset(email: string, o: { origin: string; enviar?: EnviarEmail; convite?: boolean }): Promise<void> {
  const u = (await query<any>("SELECT id, email, nome FROM admin_users WHERE email=$1 AND ativo", [normEmail(email)])).rows[0];
  if (!u) return;
  const recentes = (await query<{ n: number }>("SELECT COUNT(*)::int n FROM admin_reset WHERE user_id=$1 AND criado_em > now() - interval '1 hour'", [u.id])).rows[0].n;
  if (recentes >= 3) return;
  const token = randomBytes(32).toString("base64url");
  const minutos = o.convite ? CONVITE_MINUTOS : RESET_MINUTOS;
  await query("INSERT INTO admin_reset(user_id,token_hash,expira_em) VALUES($1,$2,now() + ($3 || ' minutes')::interval)", [u.id, sha(token), String(minutos)]);
  const link = `${o.origin.replace(/\/$/, "")}/admin/redefinir?token=${token}`;
  const primeiro = String(u.nome).split(" ")[0];
  const validade = o.convite ? "24 horas" : `${RESET_MINUTOS} minutos`;
  const intro = o.convite ? "Você foi cadastrado(a) no painel da petição pela sanção integral do PLV 12/2026. Para criar a sua senha, abra o link (vale 24 horas e só funciona uma vez)" : "Alguém pediu para redefinir a senha do painel da petição. Se foi você, abra o link (vale 30 minutos e só funciona uma vez)";
  const fim = o.convite ? "Se você não esperava este convite, ignore este e-mail." : "Se não foi você, ignore este e-mail: a sua senha continua a mesma.";
  const texto = `Olá, ${primeiro}.\n\n${intro}:\n\n${link}\n\n${fim}`;
  const html = `<p>Olá, <strong>${primeiro.replace(/[<>&"]/g, "")}</strong>.</p><p>${intro.replace(/\(vale.*$/, "")}(vale ${validade} e só funciona uma vez):</p><p><a href="${link}" style="display:inline-block;padding:12px 22px;background:#0b6b45;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">${o.convite ? "Criar a minha senha" : "Redefinir minha senha"}</a></p><p style="color:#5b6b63;font-size:13px;">${fim}</p>`;
  await (o.enviar ?? enviarPadrao)({ to: u.email, subject: o.convite ? "Convite para o painel da petição: crie a sua senha" : "Redefinir a senha do painel da petição", text: texto, html });
  await audit(o.convite ? "admin_convite_enviado" : "admin_reset_pedido", null, { id: u.id });
}

export async function redefinirSenha(token: string, nova: string): Promise<{ ok: true } | { ok: false; erro: "token_invalido" | "senha_fraca"; detalhe?: string }> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { ok: false, erro: "token_invalido" };
  const r = (await query<any>(`SELECT r.id, r.user_id, u.email FROM admin_reset r JOIN admin_users u ON u.id=r.user_id WHERE r.token_hash=$1 AND NOT r.usado AND r.expira_em > now() AND u.ativo`, [sha(token)])).rows[0];
  if (!r) return { ok: false, erro: "token_invalido" };
  const fraca = problemaNaSenha(nova, r.email);
  if (fraca) return { ok: false, erro: "senha_fraca", detalhe: fraca };
  await query("UPDATE admin_users SET senha_hash=$2, trocar_senha=false, falhas=0, bloqueado_ate=NULL WHERE id=$1", [r.user_id, hashSenha(nova)]);
  await query("UPDATE admin_reset SET usado=true WHERE user_id=$1", [r.user_id]);
  await encerrarSessoesDoUsuario(r.user_id); // quem tinha a senha antiga perde as sessões
  await audit("admin_senha_redefinida", null, { id: r.user_id });
  return { ok: true };
}

// ---- gestão (só nível total) ----
export async function listarUsuarios(): Promise<Usuario[]> {
  return (await query<any>("SELECT * FROM admin_users ORDER BY ativo DESC, nivel DESC, nome")).rows.map(doUsuario);
}
/** Quantos usuários ATIVOS de nível total existem, sem contar `exceto`. O painel nunca pode ficar sem nenhum. */
async function totaisSem(exceto: number): Promise<number> {
  return (await query<{ n: number }>("SELECT COUNT(*)::int n FROM admin_users WHERE ativo AND nivel='total' AND id<>$1", [exceto])).rows[0].n;
}
export async function alterarNivel(id: number, nivel: Nivel, por: string): Promise<{ ok: true } | { ok: false; erro: "ultimo_total" | "nao_existe" | "nivel_invalido" }> {
  if (!ehNivel(nivel)) return { ok: false, erro: "nivel_invalido" };
  const u = (await query<any>("SELECT nivel, ativo FROM admin_users WHERE id=$1", [id])).rows[0];
  if (!u) return { ok: false, erro: "nao_existe" };
  if (u.nivel === "total" && u.ativo && nivel !== "total" && (await totaisSem(id)) === 0) return { ok: false, erro: "ultimo_total" };
  await query("UPDATE admin_users SET nivel=$2 WHERE id=$1", [id, nivel]);
  await audit("admin_usuario_nivel", null, { id, de: u.nivel, para: nivel, por });
  return { ok: true };
}
export async function definirAtivo(id: number, ativo: boolean, por: string): Promise<{ ok: true } | { ok: false; erro: "ultimo_total" | "nao_existe" }> {
  const u = (await query<any>("SELECT nivel, ativo FROM admin_users WHERE id=$1", [id])).rows[0];
  if (!u) return { ok: false, erro: "nao_existe" };
  if (!ativo && u.nivel === "total" && u.ativo && (await totaisSem(id)) === 0) return { ok: false, erro: "ultimo_total" };
  await query("UPDATE admin_users SET ativo=$2 WHERE id=$1", [id, ativo]);
  if (!ativo) await encerrarSessoesDoUsuario(id);
  await audit(ativo ? "admin_usuario_ativado" : "admin_usuario_desativado", null, { id, por });
  return { ok: true };
}
/** O próprio usuário troca a senha (precisa da atual). */
export async function trocarMinhaSenha(userId: number, atual: string, nova: string): Promise<{ ok: true } | { ok: false; erro: "atual_errada" | "senha_fraca"; detalhe?: string }> {
  const u = (await query<any>("SELECT email, senha_hash FROM admin_users WHERE id=$1 AND ativo", [userId])).rows[0];
  if (!u || !verificarHash(atual, u.senha_hash)) return { ok: false, erro: "atual_errada" };
  const fraca = problemaNaSenha(nova, u.email);
  if (fraca) return { ok: false, erro: "senha_fraca", detalhe: fraca };
  await query("UPDATE admin_users SET senha_hash=$2, trocar_senha=false WHERE id=$1", [userId, hashSenha(nova)]);
  await audit("admin_senha_trocada", null, { id: userId });
  return { ok: true };
}
