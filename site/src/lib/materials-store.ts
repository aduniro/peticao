import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { tx, audit } from "./db";
import { nivelOk, type Nivel } from "./admin-levels";
import { materialId, materialMutation, materialRequestDigest, materialDigest, materialRevision, materialVersion, type MaterialMutation } from "./materials-contract";

type Actor = { userId: number; sessaoId: number | null; email: string };
const failed = (error: "disabled" | "parameters" | "forbidden" | "not_found" | "conflict" | "request_conflict" | "archived") => ({ ok: false as const, error });
const enabled = () => process.env.MATERIALS_LIBRARY_ENABLED === "1";
async function context(c: PoolClient, actor: Actor | null, write: boolean) {
  await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='5000ms'");
  if (!actor || !Number.isInteger(actor.userId) || actor.userId < 1 || !Number.isInteger(actor.sessaoId) || Number(actor.sessaoId) < 1) return false;
  const row = (await c.query<{ nivel: Nivel }>(`SELECT u.nivel FROM admin_users u JOIN admin_sessions s ON s.user_id=u.id
    WHERE u.id=$1 AND s.id=$2 AND u.email=$3 AND u.ativo AND NOT u.trocar_senha AND s.expira_em>clock_timestamp() FOR SHARE OF u,s`,
  [actor.userId, actor.sessaoId, actor.email.trim().toLowerCase()])).rows[0];
  return !!row && nivelOk(row.nivel, write ? "edicao" : "leitura");
}
async function version(c: PoolClient, id: string) {
  const row = (await c.query("SELECT * FROM campaign_material_versions WHERE id=$1", [id])).rows[0];
  if (!row) throw new Error("material_head_missing_version");
  return materialVersion(row);
}
async function replay(c: PoolClient, input: MaterialMutation, actor: Actor) {
  const row = (await c.query<{ fingerprint: string; version_id: string }>("SELECT fingerprint,version_id FROM campaign_material_requests WHERE actor_id=$1 AND request_id=$2", [actor.userId, input.requestId])).rows[0];
  if (!row) return null;
  if (row.fingerprint !== materialRequestDigest(input)) return failed("request_conflict");
  return { ok: true as const, replayed: true, version: await version(c, row.version_id) };
}
/** One transaction appends content, moves the CAS head, records a durable receipt and audits. */
export async function mutateMaterial(raw: unknown, actor: Actor | null) {
  if (!enabled()) return failed("disabled");
  const input = materialMutation(raw); if (!input) return failed("parameters");
  return tx(async c => {
    if (!await context(c, actor, true) || !actor) return failed("forbidden");
    // Stable lock order: current actor/session, per-actor request serialization, one material head.
    await c.query("SELECT pg_advisory_xact_lock(7347,$1)", [actor.userId]);
    const previous = await replay(c, input, actor); if (previous) return previous;
    const id = input.operation === "create" ? randomUUID() : input.materialId;
    const head = input.operation === "create" ? null : (await c.query("SELECT * FROM campaign_materials WHERE id=$1 FOR UPDATE", [id])).rows[0];
    if (input.operation !== "create" && !head) return failed("not_found");
    if (head && (head.revision !== (input as Exclude<MaterialMutation, { operation: "create" }>).expectedRevision || !materialRevision(head.revision + 1))) return failed("conflict");
    if (head?.archived) return failed("archived");
    const content = input.operation === "archive" ? (await version(c, head.current_version)).content : input.content;
    const ordinal = head ? head.revision + 1 : 1, versionId = randomUUID(), archived = input.operation === "archive";
    if (!head) await c.query("INSERT INTO campaign_materials(id,revision,current_version,archived,created_by,updated_by) VALUES($1,1,$2,false,$3,$3)", [id, versionId, actor.userId]);
    await c.query("INSERT INTO campaign_material_versions(id,material_id,ordinal,content,sha256,archived,author_id) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7)",
      [versionId, id, ordinal, JSON.stringify(content), materialDigest(content), archived, actor.userId]);
    if (head) {
      const moved = await c.query("UPDATE campaign_materials SET revision=$2,current_version=$3,archived=$4,updated_by=$5,updated_at=clock_timestamp() WHERE id=$1 AND revision=$6 RETURNING id", [id, ordinal, versionId, archived, actor.userId, head.revision]);
      if (moved.rowCount !== 1) throw new Error("material_cas_lost");
    }
    await c.query("INSERT INTO campaign_material_requests(actor_id,request_id,fingerprint,version_id) VALUES($1,$2,$3,$4)", [actor.userId, input.requestId, materialRequestDigest(input), versionId]);
    await audit("campaign_material_" + input.operation, null, { materialId: id, versionId, revision: ordinal, userId: actor.userId, contentSha256: materialDigest(content), requestId: input.requestId }, c);
    return { ok: true as const, replayed: false, version: await version(c, versionId) };
  });
}
/** Recovery of an admitted request is read-only and actor-scoped; never retries a mutation. */
export async function readMaterialRequest(requestId: string, actor: Actor | null) {
  if (!enabled()) return failed("disabled");
  if (!materialId(requestId)) return failed("parameters");
  return tx(async c => {
    if (!await context(c, actor, false) || !actor) return failed("forbidden");
    const row = (await c.query<{ version_id: string }>("SELECT version_id FROM campaign_material_requests WHERE actor_id=$1 AND request_id=$2", [actor.userId, requestId])).rows[0];
    return row ? { ok: true as const, version: await version(c, row.version_id) } : failed("not_found");
  });
}
export async function listMaterials(actor: Actor | null, archived: boolean, before: string | null) {
  if (!enabled()) return failed("disabled");
  if (typeof archived !== "boolean" || before !== null && !materialId(before)) return failed("parameters");
  return tx(async c => {
    if (!await context(c, actor, false)) return failed("forbidden");
    const rows = (await c.query(`SELECT v.* FROM campaign_materials m JOIN campaign_material_versions v ON v.id=m.current_version
      WHERE m.archived=$1 AND ($2::uuid IS NULL OR m.id<$2::uuid) ORDER BY m.id DESC LIMIT 51`, [archived, before])).rows;
    return { ok: true as const, versions: rows.slice(0, 50).map(materialVersion), nextBefore: rows.length > 50 ? String(rows[49].material_id) : null };
  });
}
export async function materialHistory(id: string, actor: Actor | null, before: number | null) {
  if (!enabled()) return failed("disabled");
  if (!materialId(id) || before !== null && !materialRevision(before)) return failed("parameters");
  return tx(async c => {
    if (!await context(c, actor, false)) return failed("forbidden");
    const head = (await c.query("SELECT current_version FROM campaign_materials WHERE id=$1 FOR SHARE", [id])).rows[0];
    if (!head) return failed("not_found");
    const rows = (await c.query("SELECT * FROM campaign_material_versions WHERE material_id=$1 AND ($2::int IS NULL OR ordinal<$2) ORDER BY ordinal DESC LIMIT 51", [id, before])).rows;
    return { ok: true as const, current: await version(c, head.current_version), versions: rows.slice(0, 50).map(materialVersion), nextBefore: rows.length > 50 ? rows[49].ordinal as number : null };
  });
}
