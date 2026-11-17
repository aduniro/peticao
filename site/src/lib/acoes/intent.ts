import { createHash } from "node:crypto";
import { tx } from "../db";
import type { PoolClient } from "pg";
import type { Ctx } from "./tipos";
export type ActionIntent = { id: number; token: string; expira: string };
export type ActionRecord = { id: number; central_estado: string; resultado: Record<string, unknown> | null };
export type IntentCheck = { kind: "invalid" } | { kind: "ready"; id: number } | { kind: "expired" } | { kind: "recorded"; record: ActionRecord };
export const intentHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** Shared lock order for admission and consultation: simulation row, then execution lookup. */
export async function checkIntent(client: PoolClient, input: unknown, acao: string, parameters: unknown, actor: Ctx): Promise<IntentCheck> {
  const value = input as Partial<ActionIntent> | null;
  if (!value || !Number.isSafeInteger(value.id) || value.id! < 1 || value.id! > 2_147_483_647 || typeof value.token !== "string" || !/^[a-f0-9]{48}$/.test(value.token)) return { kind: "invalid" };
  const row = (await client.query<{ id: number; ts: Date }>(`SELECT id,ts FROM admin_acoes WHERE id=$1 AND acao=$2 AND email=$3 AND user_id IS NOT DISTINCT FROM $4 AND modo='simular' AND central_estado='concluido' AND central_simulacao_hash=$5 AND parametros=$6::jsonb FOR UPDATE`, [value.id, acao, actor.email, actor.userId || null, intentHash(value.token), JSON.stringify(parameters ?? {})])).rows[0];
  if (!row) return { kind: "invalid" };
  const existing = (await client.query<ActionRecord>("SELECT id,central_estado,resultado FROM admin_acoes WHERE central_simulacao_id=$1 AND modo='executar'", [row.id])).rows[0];
  // Retrieving an existing execution remains valid after admission expiry.
  if (existing) return { kind: "recorded", record: existing };
  const fresh = (await client.query<{ fresh: boolean }>("SELECT $1::timestamptz+interval '15 minutes'>clock_timestamp() fresh", [row.ts])).rows[0].fresh;
  return fresh ? { kind: "ready", id: row.id } : { kind: "expired" };
}

export const inspectIntent = (input: unknown, acao: string, parameters: unknown, actor: Ctx) => tx(client => checkIntent(client, input, acao, parameters, actor));
