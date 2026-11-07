import { audit, query, tx } from "../db";
import { comprovantePublicacao, type ComprovantePublicacao } from "../publicar";
import type { Ctx } from "./tipos";

const validId = (id: unknown): id is number => Number.isSafeInteger(id) && Number(id) > 0 && Number(id) <= 2_147_483_647;
export type HistoryRow = { id: number; ts: Date; email: string; acao: string; modo: string; ok: boolean; central_estado: string; central_fim: Date | null; central_request_id: string | null; central_simulacao_id: number | null; publicacao: ComprovantePublicacao | null };
/** Bounded keyset history: no raw simulation capability, logs, full result or participant details. */
export async function historicoAcoes(before?: number, limit = 30) {
  if (before !== undefined && !validId(before) || !Number.isInteger(limit) || limit < 1 || limit > 50) return { ok: false as const, erro: "parametros" as const };
  const rows = (await query<HistoryRow>(`SELECT id,ts,email,acao,modo,ok,central_estado,central_fim,central_request_id,central_simulacao_id,resultado->'publicacao' publicacao
    FROM admin_acoes WHERE ($1::int IS NULL OR id<$1) ORDER BY id DESC LIMIT $2`, [before ?? null, limit + 1])).rows;
  const more = rows.length > limit; const items = rows.slice(0, limit);
  return { ok: true as const, registros: items, proximo: more ? items[items.length - 1].id : null };
}

/** No arbitrary verdicts and no effect replay: root receipt + exact request/candidate are the only evidence. */
export async function conciliarPublicacao(id: unknown, actor: Ctx) {
  if (!validId(id)) return { ok: false as const, erro: "parametros" as const };
  return tx(async client => {
    const lock = (await client.query<{ g: boolean }>("SELECT pg_try_advisory_xact_lock(hashtext(current_schema()),hashtext('acao-grupo:publicar')) g")).rows[0].g;
    if (!lock) return { ok: false as const, erro: "ocupado" as const };
    const row = (await client.query<{ central_estado: string; central_request_id: string | null; parametros: { candidato?: string } }>(`SELECT central_estado,central_request_id,parametros FROM admin_acoes WHERE id=$1 AND acao='publicar.pedir' AND modo='executar' FOR UPDATE`, [id])).rows[0];
    if (!row) return { ok: false as const, erro: "nao_encontrado" as const };
    if (row.central_estado === "legacy" || !row.central_request_id || typeof row.parametros?.candidato !== "string") return { ok: false as const, erro: "sem_evidencia" as const };
    const receipt = comprovantePublicacao(row.central_request_id, row.parametros.candidato);
    if (!receipt) return { ok: false as const, erro: "sem_evidencia" as const };
    // Failure can leave a partial deploy or surviving children. Never infer a safe retry from an exit code.
    const uncertain = receipt.estado === "falhou";
    const state = uncertain ? "indeterminado" : ["ok", "falhou"].includes(receipt.estado) ? "aceito" : "falhou";
    const updated = await client.query(`UPDATE admin_acoes SET central_estado=$2,ok=$3,central_fim=COALESCE(central_fim,now()),resultado=COALESCE(resultado,'{}'::jsonb)||jsonb_build_object('publicacao',$4::jsonb)
      WHERE id=$1 AND (central_estado IS DISTINCT FROM $2 OR resultado->'publicacao' IS DISTINCT FROM $4::jsonb) RETURNING id`, [id, state, state === "aceito", JSON.stringify(receipt)]);
    if (updated.rowCount) await audit("admin_acao_conciliada", null, { por: actor.email, userId: actor.userId, acaoId: id, pedido: row.central_request_id, estadoAnterior: row.central_estado, estado: state, comprovante: receipt }, client);
    return { ok: true as const, id, estado: state, publicacao: receipt, alterado: !!updated.rowCount };
  });
}
