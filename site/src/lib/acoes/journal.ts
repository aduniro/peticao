import { randomBytes } from "node:crypto";
import { audit, query, tx } from "../db";
import type { PoolClient } from "pg";
import type { Ctx } from "./tipos";
import { checkIntent, intentHash, type ActionIntent, type IntentCheck } from "./intent";
export type ActionState = "concluido" | "aceito" | "falhou" | "indeterminado";

/** Durable admission, before any effect. The lock transaction must not own the audit lock yet. */
export async function prepareAction(acao: string, parametros: unknown, actor: Ctx, transactional: boolean, intent?: unknown): Promise<{ id: number; requestId: string } | { checked: IntentCheck }> {
  return tx(async client => {
    let simulationId: number | null = null;
    if (intent !== undefined) {
      const checked = await checkIntent(client, intent, acao, parametros, actor);
      if (checked.kind !== "ready") return { checked };
      simulationId = checked.id;
    }
    const requestId = randomBytes(8).toString("hex");
    const row = (await client.query<{ id: number }>("INSERT INTO admin_acoes(user_id,email,acao,parametros,modo,ok,central_estado,central_transacional,central_request_id,central_simulacao_id) VALUES($1,$2,$3,$4,'executar',false,'solicitado',$5,$6,$7) RETURNING id", [actor.userId || null, actor.email, acao, JSON.stringify(parametros ?? {}), transactional, requestId, simulationId])).rows[0];
    await audit("admin_acao_pedida", null, { acao, por: actor.email, acaoId: row.id, transacional: transactional, pedido: requestId, simulacaoId: simulationId }, client);
    return { id: row.id, requestId };
  });
}

export async function finishAction(id: number, actor: Ctx, state: ActionState, result: unknown, client?: PoolClient): Promise<void> {
  const run = async (c: PoolClient) => {
    const ok = state === "concluido" || state === "aceito";
    const updated = await c.query<{ acao: string }>("UPDATE admin_acoes SET central_estado=$3,central_fim=now(),resultado=$4,ok=$5 WHERE id=$1 AND email=$2 AND central_estado IN ('solicitado','indeterminado') RETURNING acao", [id, actor.email, state, JSON.stringify(result ?? {}), ok]);
    if (updated.rowCount) await audit("admin_acao_executada", null, { acao: updated.rows[0].acao, por: actor.email, acaoId: id, estado: state, ok }, c);
  };
  if (client) await run(client); else await tx(run);
}

/** Called only while holding the group's DB lock: no previous worker of this group can still be active. */
export async function recoverActions(groupIds: string[], currentId: string): Promise<boolean> {
  return tx(async client => {
    const rows = (await client.query<{ id: number; acao: string; central_estado: string; central_transacional: boolean }>("SELECT id,acao,central_estado,central_transacional FROM admin_acoes WHERE acao=ANY($1::text[]) AND modo='executar' AND central_estado IN ('solicitado','indeterminado') ORDER BY id FOR UPDATE", [groupIds])).rows;
    const recovered: { id: number; estado: string }[] = [];
    for (const row of rows) {
      // A DB-only effect and its final result commit together. Pending means it did not commit.
      const state = row.central_transacional ? "falhou" : "indeterminado";
      if (row.central_estado !== state) {
        await client.query("UPDATE admin_acoes SET central_estado=$2,central_fim=now(),ok=false WHERE id=$1", [row.id, state]);
        recovered.push({ id: row.id, estado: state });
      }
    }
    if (recovered.length) await audit("admin_acoes_recuperadas", null, { acoes: recovered }, client);
    return rows.some(row => row.acao === currentId && !row.central_transacional);
  });
}

export async function recordRead(acao: string, parameters: unknown, mode: string, actor: Ctx, result: unknown, issueIntent = false): Promise<ActionIntent | null> {
  return tx(async client => {
    const token = issueIntent ? randomBytes(24).toString("hex") : null;
    const row = (await client.query<{ id: number; expira: Date }>("INSERT INTO admin_acoes(user_id,email,acao,parametros,modo,resultado,ok,central_estado,central_fim,central_simulacao_hash) VALUES($1,$2,$3,$4,$5,$6,true,'concluido',now(),$7) RETURNING id,ts+interval '15 minutes' expira", [actor.userId || null, actor.email, acao, JSON.stringify(parameters ?? {}), mode, JSON.stringify(result ?? {}), token ? intentHash(token) : null])).rows[0];
    if (mode === "executar") await audit("admin_acao_executada", null, { acao, por: actor.email, acaoId: row.id, estado: "concluido", ok: true }, client);
    return token ? { id: row.id, token, expira: row.expira.toISOString() } : null;
  });
}


export async function readAction(id: number, actor: Ctx) {
  return (await query<{ central_estado: string; resultado: Record<string, unknown> }>("SELECT central_estado,resultado FROM admin_acoes WHERE id=$1 AND email=$2", [id, actor.email])).rows[0] ?? null;
}


/** Optional post-commit information never changes whether the core operation completed. */
export async function supplementAction(id: number, actor: Ctx, patch: Record<string, unknown>): Promise<void> {
  await tx(async client => {
    const row = await client.query("UPDATE admin_acoes SET resultado=resultado || $3::jsonb WHERE id=$1 AND email=$2 AND central_estado='concluido' RETURNING id", [id, actor.email, JSON.stringify(patch)]);
    if (row.rowCount) await audit("admin_acao_complemento", null, { acaoId: id, por: actor.email, complemento: patch }, client);
  });
}
