import type { PoolClient } from "pg";
import { audit, tx } from "../db";
import { PURPOSES, type Purpose } from "../knowledge/catalog";
import { aiExecutionAvailable } from "./execution-gate";
export const CONFIG_KEY = "admin_ai_profiles_v1";
export const EFFORTS = ["default", "none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Profile = { provider: "openai"; model: string | null; effort: typeof EFFORTS[number] };
export type AiConfiguration = { enabled: boolean; profiles: Record<Purpose, Profile>; limits: { maxInputBytes: number; maxOutputTokens: number; dailyCalls: number; dailyOutputTokens: number } };
export const exactKeys = (v: unknown, keys: string[]) => !!v && typeof v === "object" && !Array.isArray(v) && Object.keys(v).sort().join(",") === [...keys].sort().join(",");
const integer = (v: unknown, min: number, max: number) => Number.isInteger(v) && Number(v) >= min && Number(v) <= max;
export function defaultConfiguration(): AiConfiguration {
  const profile = (): Profile => ({ provider: "openai", model: null, effort: "default" });
  return { enabled: false, profiles: { painel: profile(), divulgacao: profile(), atendimento: profile() }, limits: { maxInputBytes: 12000, maxOutputTokens: 1024, dailyCalls: 5, dailyOutputTokens: 5120 } };
}
/** Selection is not an assertion of model availability. No credential or arbitrary endpoint belongs in this object. */
export function parseConfiguration(v: unknown): AiConfiguration | null {
  if (!exactKeys(v, ["enabled", "profiles", "limits"])) return null;
  const c = v as AiConfiguration;
  if (typeof c.enabled !== "boolean" || !exactKeys(c.profiles, [...PURPOSES]) || !exactKeys(c.limits, ["maxInputBytes", "maxOutputTokens", "dailyCalls", "dailyOutputTokens"])) return null;
  for (const purpose of PURPOSES) {
    const p = c.profiles[purpose];
    if (!exactKeys(p, ["provider", "model", "effort"]) || p.provider !== "openai" || !EFFORTS.includes(p.effort) || p.model !== null && (typeof p.model !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p.model) || /^sk-/i.test(p.model)) || c.enabled && !p.model) return null;
  }
  if (!integer(c.limits.maxInputBytes, 1024, 32000) || !integer(c.limits.maxOutputTokens, 16, 4096) || !integer(c.limits.dailyCalls, 1, 100) || !integer(c.limits.dailyOutputTokens, c.limits.maxOutputTokens, 100000)) return null;
  return structuredClone(c);
}
export async function readConfigurationWith(c: PoolClient) {
  const row = (await c.query("SELECT value FROM settings WHERE key=$1", [CONFIG_KEY])).rows[0];
  if (!row) return { ok: true as const, revision: 0, config: defaultConfiguration(), executionAvailable: false };
  try {
    const stored = JSON.parse(row.value), config = parseConfiguration(stored.config);
    if (!exactKeys(stored, ["revision", "config"]) || !integer(stored.revision, 1, 2147483647) || !config) throw new Error("invalid");
    return { ok: true as const, revision: stored.revision as number, config, executionAvailable: aiExecutionAvailable(config.enabled) };
  } catch { return { ok: false as const, error: "configuration_invalid" }; }
}
export async function aiConfiguration() {
  return tx(async c => {
    await c.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY"); await c.query("SET LOCAL statement_timeout='1500ms'");
    return readConfigurationWith(c);
  });
}
export async function saveAiConfiguration(raw: unknown, expectedRevision: unknown, actor: { userId: number; email: string }) {
  const config = parseConfiguration(raw);
  if (!config || !integer(expectedRevision, 0, 2147483646) || !actor || !integer(actor.userId, 1, 2147483647) || typeof actor.email !== "string" || actor.email.length > 254) return { ok: false as const, error: "parameters" };
  return tx(async c => {
    await c.query("SET LOCAL lock_timeout='1000ms'; SET LOCAL statement_timeout='3000ms'");
    if (!(await c.query("SELECT 1 FROM admin_users WHERE id=$1 AND lower(email)=$2 AND ativo AND nivel='total' FOR SHARE", [actor.userId, actor.email.toLowerCase()])).rowCount) return { ok: false as const, error: "forbidden" };
    await c.query("SELECT pg_advisory_xact_lock(hashtext(current_schema()),hashtext($1))", [CONFIG_KEY]);
    const before = await readConfigurationWith(c); if (!before.ok) return before;
    if (before.revision !== expectedRevision) return { ok: false as const, error: "configuration_conflict" };
    const revision = before.revision + 1;
    await c.query("INSERT INTO settings(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value", [CONFIG_KEY, JSON.stringify({ revision, config })]);
    await audit("admin_ai_configuration_changed", null, { revision, previous: before.config, config, userId: actor.userId, por: actor.email.toLowerCase() }, c);
    return { ok: true as const, revision, config, executionAvailable: aiExecutionAvailable(config.enabled) };
  });
}
