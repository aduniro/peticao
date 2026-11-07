import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { audit, query, tx } from "./db";
import { hmac } from "./security";
import { ehNivel, type Nivel } from "./admin-levels";
import { SAFE_EMAIL_RE } from "./email-syntax";
import { HASH_FALSO, gerarSenha, hashSenha, problemaNaSenha, verificarHash } from "./senha";

/**
 * Usuários do painel, com quatro níveis (cada um inclui os de baixo): leitura < edição < exclusão < total.
 * Sessão guardada no banco (só o hash do token), com validade e revogável na hora; senha scrypt; bloqueio após 5 erros; redefinição por e-mail.
 * A senha única antiga (lib/admin.ts) só vale enquanto NÃO existir nenhum usuário (ver `temUsuarios`).
 */
export { NIVEIS, ROTULO_NIVEL, nivelOk, ehNivel, type Nivel } from "./admin-levels";

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

export type ResultadoCriar = { ok: true; usuario: Usuario; senhaGerada: string | null } | { ok: false; erro: "email_invalido" | "nome_invalido" | "nivel_invalido" | "email_ja_existe" | "senha_fraca" | "nao_autorizado"; detalhe?: string };
export async function criarUsuario(o: { email: string; nome: string; nivel: Nivel; senha?: string; trocarSenha?: boolean; por?: string; actor?: { userId: number; email: string } }): Promise<ResultadoCriar> {
  const email = normEmail(o.email), nome = o.nome.replace(/\s+/g, " ").trim();
  if (!SAFE_EMAIL_RE.test(email)) return { ok: false, erro: "email_invalido" };
  if (nome.length < 2 || nome.length > 120) return { ok: false, erro: "nome_invalido" };
  if (!ehNivel(o.nivel)) return { ok: false, erro: "nivel_invalido" };
  const senha = o.senha ?? gerarSenha();
  const fraca = o.senha ? problemaNaSenha(senha, email) : null;
  if (fraca) return { ok: false, erro: "senha_fraca", detalhe: fraca };
  const senhaHash = hashSenha(senha);
  return tx(async c => {
    // Use the same lock order as role/deactivation changes. CLI bootstrap has no actor.
    await c.query("SELECT pg_advisory_xact_lock(7003)");
    if (o.actor !== undefined) {
      const actor = o.actor;
      if (!Number.isInteger(actor?.userId) || actor.userId <= 0 || actor.userId > 2147483647 || typeof actor.email !== "string") return { ok: false as const, erro: "nao_autorizado" as const };
      const current = await c.query("SELECT id FROM admin_users WHERE id=$1 AND email=$2 AND ativo AND nivel='total' FOR SHARE", [actor.userId, normEmail(actor.email)]);
      if (!current.rowCount) return { ok: false as const, erro: "nao_autorizado" as const };
    }
    const r = await c.query("INSERT INTO admin_users(email,nome,nivel,senha_hash,trocar_senha) VALUES($1,$2,$3,$4,$5) ON CONFLICT(email) DO NOTHING RETURNING *", [email, nome, o.nivel, senhaHash, o.trocarSenha ?? !o.senha]);
    if (!r.rowCount) return { ok: false as const, erro: "email_ja_existe" as const };
    const usuario = doUsuario(r.rows[0]);
    await audit("admin_usuario_criado", null, { id: usuario.id, nivel: usuario.nivel, por: o.actor ? normEmail(o.actor.email) : o.por ?? "cli", ...(o.actor ? { userId: o.actor.userId } : {}) }, c);
    return { ok: true as const, usuario, senhaGerada: o.senha ? null : senha };
  });
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
async function enviarPadrao(m: { to: string; subject: string; text: string; html: string }) { const { sendMail } = await import("./mail"); return sendMail(m, "admin"); }

export type ResetRequestResult = { estado: "sent" | "queued" } | { estado: "skipped"; motivo: "unavailable" | "quota" };

/** Pede a redefinição: se o e-mail tem conta ativa, manda um link de uso único (30 min). Nunca revela se a conta existe. No máximo 3 pedidos por hora por conta. */
export async function pedirReset(email: string, o: { origin: string; enviar?: EnviarEmail; convite?: boolean }): Promise<ResetRequestResult> {
  const reserved = await tx(async c => {
    const user = (await c.query<{ id: number; email: string; nome: string }>("SELECT id,email,nome FROM admin_users WHERE email=$1 AND ativo FOR UPDATE", [normEmail(email)])).rows[0];
    if (!user) return { estado: "skipped" as const, motivo: "unavailable" as const };
    const recentes = (await c.query<{ n: number }>("SELECT COUNT(*)::int n FROM admin_reset WHERE user_id=$1 AND criado_em > now() - interval '1 hour'", [user.id])).rows[0].n;
    if (recentes >= 3) return { estado: "skipped" as const, motivo: "quota" as const };
    const token = randomBytes(32).toString("base64url");
    const minutos = o.convite ? CONVITE_MINUTOS : RESET_MINUTOS;
    await c.query("INSERT INTO admin_reset(user_id,token_hash,expira_em) VALUES($1,$2,now() + ($3 || ' minutes')::interval)", [user.id, sha(token), String(minutos)]);
    await audit("admin_reset_reservado", null, { id: user.id, convite: !!o.convite }, c);
    return { estado: "reserved" as const, user, token };
  });
  if (reserved.estado === "skipped") return reserved;
  const { user: u, token } = reserved;
  const link = `${o.origin.replace(/\/$/, "")}/admin/redefinir?token=${token}`;
  const primeiro = String(u.nome).split(" ")[0];
  const validade = o.convite ? "24 horas" : `${RESET_MINUTOS} minutos`;
  const intro = o.convite ? "Você foi cadastrado(a) no painel da petição pela sanção integral do PLV 12/2026. Para criar a sua senha, abra o link (vale 24 horas e só funciona uma vez)" : "Alguém pediu para redefinir a senha do painel da petição. Se foi você, abra o link (vale 30 minutos e só funciona uma vez)";
  const fim = o.convite ? "Se você não esperava este convite, ignore este e-mail." : "Se não foi você, ignore este e-mail: a sua senha continua a mesma.";
  const texto = `Olá, ${primeiro}.\n\n${intro}:\n\n${link}\n\n${fim}`;
  const html = `<p>Olá, <strong>${primeiro.replace(/[<>&"]/g, "")}</strong>.</p><p>${intro.replace(/\(vale.*$/, "")}(vale ${validade} e só funciona uma vez):</p><p><a href="${link}" style="display:inline-block;padding:12px 22px;background:#0b6b45;color:#fff;border-radius:8px;text-decoration:none;font-weight:700;">${o.convite ? "Criar a minha senha" : "Redefinir minha senha"}</a></p><p style="color:#5b6b63;font-size:13px;">${fim}</p>`;
  const outcome = await (o.enviar ?? enviarPadrao)({ to: u.email, subject: o.convite ? "Convite para o painel da petição: crie a sua senha" : "Redefinir a senha do painel da petição", text: texto, html });
  if (outcome !== undefined && outcome !== "sent" && outcome !== "queued") throw new Error("Unexpected password reset delivery result");
  const estado = outcome === "queued" ? "queued" as const : "sent" as const;
  await audit(o.convite ? "admin_convite_enviado" : "admin_reset_pedido", null, { id: u.id, estado });
  return { estado };
}

export async function redefinirSenha(token: string, nova: string): Promise<{ ok: true } | { ok: false; erro: "token_invalido" | "senha_fraca"; detalhe?: string }> {
  if (!/^[A-Za-z0-9_-]{40,60}$/.test(token)) return { ok: false, erro: "token_invalido" };
  // Lock the account before its reset tokens: all resets for one account serialize.
  const found = (await query<{ user_id: number }>("SELECT user_id FROM admin_reset WHERE token_hash=$1", [sha(token)])).rows[0];
  if (!found) return { ok: false, erro: "token_invalido" };
  return tx(async (c) => {
    const u = (await c.query("SELECT email FROM admin_users WHERE id=$1 AND ativo FOR UPDATE", [found.user_id])).rows[0];
    if (!u) return { ok: false as const, erro: "token_invalido" as const };
    const r = (await c.query("SELECT id FROM admin_reset WHERE user_id=$1 AND token_hash=$2 AND NOT usado AND expira_em > now() FOR UPDATE", [found.user_id, sha(token)])).rows[0];
    if (!r) return { ok: false as const, erro: "token_invalido" as const };
    const fraca = problemaNaSenha(nova, u.email);
    if (fraca) return { ok: false as const, erro: "senha_fraca" as const, detalhe: fraca };
    await c.query("UPDATE admin_users SET senha_hash=$2, trocar_senha=false, falhas=0, bloqueado_ate=NULL WHERE id=$1", [found.user_id, hashSenha(nova)]);
    await c.query("UPDATE admin_reset SET usado=true WHERE user_id=$1", [found.user_id]);
    await c.query("DELETE FROM admin_sessions WHERE user_id=$1", [found.user_id]);
    await audit("admin_senha_redefinida", null, { id: found.user_id }, c);
    return { ok: true as const };
  });
}

// ---- gestão (só nível total) ----
export async function listarUsuarios(): Promise<Usuario[]> {
  return (await query<any>("SELECT * FROM admin_users ORDER BY ativo DESC, nivel DESC, nome")).rows.map(doUsuario);
}
/** Account management shares a transaction lock so two requests cannot remove both owners. */
export async function alterarNivel(id: number, nivel: Nivel, por: string): Promise<{ ok: true } | { ok: false; erro: "ultimo_total" | "nao_existe" | "nivel_invalido" }> {
  if (!ehNivel(nivel)) return { ok: false, erro: "nivel_invalido" };
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(7003)");
    const u = (await c.query("SELECT nivel, ativo FROM admin_users WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!u) return { ok: false as const, erro: "nao_existe" as const };
    const remaining = (await c.query("SELECT COUNT(*)::int n FROM admin_users WHERE ativo AND nivel='total' AND id<>$1", [id])).rows[0].n;
    if (u.nivel === "total" && u.ativo && nivel !== "total" && remaining === 0) return { ok: false as const, erro: "ultimo_total" as const };
    await c.query("UPDATE admin_users SET nivel=$2 WHERE id=$1", [id, nivel]);
    await audit("admin_usuario_nivel", null, { id, de: u.nivel, para: nivel, por }, c);
    return { ok: true as const };
  });
}
export async function definirAtivo(id: number, ativo: boolean, por: string): Promise<{ ok: true } | { ok: false; erro: "ultimo_total" | "nao_existe" }> {
  return tx(async (c) => {
    await c.query("SELECT pg_advisory_xact_lock(7003)");
    const u = (await c.query("SELECT nivel, ativo FROM admin_users WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (!u) return { ok: false as const, erro: "nao_existe" as const };
    const remaining = (await c.query("SELECT COUNT(*)::int n FROM admin_users WHERE ativo AND nivel='total' AND id<>$1", [id])).rows[0].n;
    if (!ativo && u.nivel === "total" && u.ativo && remaining === 0) return { ok: false as const, erro: "ultimo_total" as const };
    await c.query("UPDATE admin_users SET ativo=$2 WHERE id=$1", [id, ativo]);
    if (!ativo) await c.query("DELETE FROM admin_sessions WHERE user_id=$1", [id]);
    await audit(ativo ? "admin_usuario_ativado" : "admin_usuario_desativado", null, { id, por }, c);
    return { ok: true as const };
  });
}
/** O próprio usuário troca a senha; atualiza senha, revoga sessões e audita atomicamente. */
export async function trocarMinhaSenha(userId: number, atual: string, nova: string): Promise<{ ok: true } | { ok: false; erro: "atual_errada" | "senha_fraca"; detalhe?: string }> {
  return tx(async (c) => {
    const u = (await c.query("SELECT email, senha_hash FROM admin_users WHERE id=$1 AND ativo FOR UPDATE", [userId])).rows[0];
    if (!u || !verificarHash(atual, u.senha_hash)) return { ok: false as const, erro: "atual_errada" as const };
    const fraca = problemaNaSenha(nova, u.email);
    if (fraca) return { ok: false as const, erro: "senha_fraca" as const, detalhe: fraca };
    await c.query("UPDATE admin_users SET senha_hash=$2, trocar_senha=false WHERE id=$1", [userId, hashSenha(nova)]);
    await c.query("DELETE FROM admin_sessions WHERE user_id=$1", [userId]);
    await c.query("UPDATE admin_reset SET usado=true WHERE user_id=$1", [userId]);
    await audit("admin_senha_trocada", null, { id: userId }, c);
    return { ok: true as const };
  });
}

// ---- confirmação extra (step-up): senha de novo + código de 6 dígitos enviado ao e-mail do próprio usuário ----
export const STEPUP_CODIGO_MIN = 10, STEPUP_VALE_MIN = 15, STEPUP_MAX_TENTATIVAS = 5, STEPUP_MAX_POR_HORA = 3;
const iguais = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const codigoHash = (sessaoId: number, codigo: string) => hmac(`stepup:${sessaoId}:${codigo}`);

/** A confirmação extra desta sessão ainda vale? A pré-visualização (PREVIEW_MODE) passa direto; a senha única de transição (sem e-mail) nunca passa. */
export const stepupValido = (s: SessaoAdmin | null): boolean => !!s && (s.preview || (!s.legado && !!s.stepupAte && s.stepupAte.getTime() > Date.now()));

/** Manda um código de 6 dígitos para o e-mail do usuário (um válido por vez, até 3 por hora). */
export async function pedirStepup(s: SessaoAdmin, enviar?: EnviarEmail): Promise<{ ok: true } | { ok: false; erro: "sem_conta" | "muitos_pedidos" }> {
  if (!s.userId || !s.sessaoId) return { ok: false, erro: "sem_conta" };
  const reservation = await tx(async c => {
    const user = (await c.query<{ email: string; nome: string }>("SELECT email,nome FROM admin_users WHERE id=$1 AND ativo FOR UPDATE", [s.userId])).rows[0];
    const session = (await c.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() FOR UPDATE", [s.sessaoId, s.userId])).rows[0];
    if (!user || !session) return { ok: false as const, erro: "sem_conta" as const };
    const recentes = (await c.query<{ n: number }>("SELECT COUNT(*)::int n FROM admin_stepup WHERE user_id=$1 AND criado_em > now() - interval '1 hour'", [s.userId])).rows[0].n;
    if (recentes >= STEPUP_MAX_POR_HORA) return { ok: false as const, erro: "muitos_pedidos" as const };
    const codigo = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await c.query("UPDATE admin_stepup SET usado=true WHERE sessao_id=$1 AND NOT usado", [s.sessaoId]);
    await c.query("INSERT INTO admin_stepup(user_id,sessao_id,codigo_hash,expira_em) VALUES($1,$2,$3,now() + ($4 || ' minutes')::interval)", [s.userId, s.sessaoId, codigoHash(s.sessaoId!, codigo), String(STEPUP_CODIGO_MIN)]);
    await audit("admin_stepup_pedido", null, { id: s.userId }, c);
    return { ok: true as const, codigo, user };
  });
  if (!reservation.ok) return reservation;
  const { codigo, user } = reservation;
  const primeiro = user.nome.split(" ")[0];
  const texto = `Olá, ${primeiro}.\n\nSeu código para liberar as ações do painel da petição: ${codigo}\n\nVale ${STEPUP_CODIGO_MIN} minutos e só funciona uma vez. Se não foi você, ignore este e-mail e troque a sua senha.`;
  const html = `<p>Olá, <strong>${primeiro.replace(/[<>&"]/g, "")}</strong>.</p><p>Seu código para liberar as ações do painel da petição:</p><p style="font-size:30px;letter-spacing:6px;font-weight:700;">${codigo}</p><p style="color:#5b6b63;font-size:13px;">Vale ${STEPUP_CODIGO_MIN} minutos e só funciona uma vez. Se não foi você, ignore este e-mail e troque a sua senha.</p>`;
  await (enviar ?? enviarPadrao)({ to: user.email, subject: "Código de confirmação do painel da petição", text: texto, html });
  return { ok: true };
}

/** Confere a senha e o código; se ambos baterem, a sessão fica liberada por 15 minutos. 5 erros no código o invalidam. */
export async function confirmarStepup(s: SessaoAdmin, senha: string, codigo: string): Promise<{ ok: true; ate: Date } | { ok: false; erro: "senha" | "codigo" | "sem_conta" }> {
  if (!s.userId || !s.sessaoId) return { ok: false, erro: "sem_conta" };
  return tx(async client => {
    // Same lock order as password changes: account, session, then challenge.
    const user = (await client.query<{ senha_hash: string }>("SELECT senha_hash FROM admin_users WHERE id=$1 AND ativo FOR UPDATE", [s.userId])).rows[0];
    const session = (await client.query("SELECT id FROM admin_sessions WHERE id=$1 AND user_id=$2 AND expira_em>now() FOR UPDATE", [s.sessaoId, s.userId])).rows[0];
    if (!user || !session) return { ok: false as const, erro: "sem_conta" as const };
    const senhaOk = verificarHash(senha, user.senha_hash);
    const challenge = (await client.query<{ id: number; codigo_hash: string }>("SELECT id,codigo_hash FROM admin_stepup WHERE sessao_id=$1 AND NOT usado AND expira_em>now() ORDER BY id DESC LIMIT 1 FOR UPDATE", [s.sessaoId])).rows[0];
    const codeOk = !!challenge && /^\d{6}$/.test(codigo) && iguais(codigoHash(s.sessaoId!, codigo), challenge.codigo_hash);
    if (!senhaOk || !codeOk) {
      if (challenge) await client.query("UPDATE admin_stepup SET tentativas=tentativas+1, usado=(tentativas+1 >= $2) WHERE id=$1", [challenge.id, STEPUP_MAX_TENTATIVAS]);
      const motivo = senhaOk ? "codigo" as const : "senha" as const;
      await audit("admin_stepup_falhou", null, { id: s.userId, motivo }, client);
      return { ok: false as const, erro: motivo };
    }
    await client.query("UPDATE admin_stepup SET usado=true WHERE id=$1", [challenge!.id]);
    const ate = new Date(Date.now() + STEPUP_VALE_MIN * 60_000);
    await client.query("UPDATE admin_sessions SET stepup_ate=$2 WHERE id=$1", [s.sessaoId, ate]);
    await audit("admin_stepup_ok", null, { id: s.userId }, client);
    return { ok: true as const, ate };
  });
}
