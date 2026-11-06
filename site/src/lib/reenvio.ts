import { query, audit } from "./db";
import { config } from "./config";
import { sendMail } from "./mail";
import { reenvioMail } from "./signatures";
import { newToken, normalizeEmail, sha256 } from "./security";
import { getSetting, setSetting } from "./batches";

/**
 * REENVIO por falha do serviço de disparo (04/11, ~04h–12h). TRAVADO: só roda com `reenvio_ativo` = código da proposta aprovada por e-mail
 * (definido a mão, no banco, depois da aprovação). Política central: o reenvio usa SEMPRE um serviço de e-mail DIFERENTE do que já enviou à pessoa
 * (rodízio com `avoid`); datas originais do cadastro intactas; no máximo 1 reenvio por cadastro; lotes pequenos; para sozinho se muita coisa falhar.
 */
export const CHAVES = { ativo: "reenvio_ativo", inicio: "reenvio_inicio", fim: "reenvio_fim", lote: "reenvio_lote" } as const;
export const reenvioAtivo = async () => (await getSetting(CHAVES.ativo, "")).trim();

export async function provedoresUsados(email: string): Promise<string[]> {
  const r = await query<{ provider: string }>("SELECT DISTINCT provider FROM mail_log WHERE lower(to_addr)=lower($1) AND status='sent' AND kind IN ('confirmacao','reenvio')", [email]);
  return r.rows.map((x) => x.provider).filter((p) => p && p !== "fila");
}

/** Quem seria reenviado: pendentes criados na janela (por padrão, a gravada nas configurações), nunca reenviados antes e sem bloqueio de e-mail. */
export async function alvos(limite: number, janela?: { ini: string; fim: string }): Promise<{ id: number; name: string; email: string; created_at: string }[]> {
  const ini = janela?.ini ?? (await getSetting(CHAVES.inicio, "")), fim = janela?.fim ?? (await getSetting(CHAVES.fim, ""));
  if (!ini || !fim) return [];
  return (await query<{ id: number; name: string; email: string; created_at: string }>(
    `SELECT s.id, s.name, s.email, s.created_at FROM signatures s
     WHERE s.status='pending' AND s.created_at::timestamptz >= $1::timestamptz AND s.created_at::timestamptz < $2::timestamptz
       AND NOT EXISTS (SELECT 1 FROM reenvio_falha r WHERE r.signature_id = s.id)
       AND NOT EXISTS (SELECT 1 FROM email_suppressions x WHERE lower(x.email)=lower(s.email))
     ORDER BY s.created_at LIMIT $3`, [ini, fim, limite])).rows;
}

export type Resumo = { ativo: boolean; enviados: number; falhas: number; restantes: number; parou?: string };

/** Processa um lote (chamado pelo agendador a cada ~2 min). Idempotente. */
export async function processarReenvio(limite?: number): Promise<Resumo> {
  const codigo = await reenvioAtivo();
  if (!codigo) return { ativo: false, enviados: 0, falhas: 0, restantes: 0 };
  const lote = Math.min(200, Math.max(1, limite ?? (Number(await getSetting(CHAVES.lote, "60")) || 60)));
  const lista = await alvos(lote);
  let enviados = 0, falhas = 0, seguidas = 0, parou: string | undefined;
  for (const r of lista) {
    const evitar = await provedoresUsados(r.email);
    const token = newToken();
    await query("UPDATE signatures SET token_hash=$1, token_expires_at=$2 WHERE id=$3 AND status='pending'", [sha256(token), new Date(Date.now() + config.tokenTtlHours * 3600_000).toISOString(), r.id]);
    try {
      await sendMail({ to: normalizeEmail(r.email), ...reenvioMail(r.name, token, r.created_at) }, "reenvio", { avoid: evitar, queue: false });
      const usado = (await query<{ provider: string }>("SELECT provider FROM mail_log WHERE lower(to_addr)=lower($1) AND kind='reenvio' AND status='sent' ORDER BY id DESC LIMIT 1", [r.email])).rows[0]?.provider ?? null;
      await query("INSERT INTO reenvio_falha(signature_id, provider, evitou, status) VALUES($1,$2,$3,'sent') ON CONFLICT DO NOTHING", [r.id, usado, evitar.join(",") || null]);
      enviados++; seguidas = 0;
    } catch (e) {
      falhas++; seguidas++;
      await query("INSERT INTO reenvio_falha(signature_id, status, erro) VALUES($1,'failed',$2) ON CONFLICT (signature_id) DO UPDATE SET status='failed', erro=EXCLUDED.erro", [r.id, String((e as Error).message).slice(0, 200)]);
      if (seguidas >= 8) { parou = "8 falhas seguidas: pausado (verifique os serviços de e-mail)"; await setSetting(CHAVES.ativo, ""); break; }
    }
  }
  await audit("reenvio_falha_lote", null, { codigo, enviados, falhas, parou: parou ?? null });
  const restantes = (await alvos(100000)).length;
  return { ativo: !parou, enviados, falhas, restantes, parou };
}
